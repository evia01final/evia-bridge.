export { EviaStorage } from "./storage.js";

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evia Bridge</title>
<style>
body{font:16px system-ui,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;background:#f7f7fb;color:#1c1c24}
main{background:white;border:1px solid #ddd;border-radius:16px;padding:20px}
input,textarea,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:10px;border:1px solid #bbb}
button{background:#2459d3;color:white;border:0;font-weight:600}
article{white-space:pre-wrap;border-bottom:1px solid #eee;padding:10px 0;overflow-wrap:anywhere}
small{color:#555}
</style></head><body><main><h1>Evia Bridge</h1><p>Intercambio de mensajes entre dispositivos.</p>
<label>Token compartido<input id="token" type="password" autocomplete="off" placeholder="Pega aquí el token configurado en Cloudflare"></label>
<label>Nombre de este dispositivo<input id="device" value="iphone" maxlength="40"></label>
<label>Mensaje<textarea id="message" rows="3" maxlength="4000" placeholder="Escribe un mensaje"></textarea></label>
<label style="display:flex;gap:10px;align-items:center;margin:12px 0"><input id="autoReply" type="checkbox" style="width:auto"> Responder automáticamente a mensajes nuevos con «RECIBIDO»</label>
<button id="send">Enviar mensaje</button><button id="refresh" type="button">Actualizar mensajes</button>
<p id="status" role="status">Listo para conectar.</p><h2>Mensajes recibidos</h2><section id="messages"></section>
<script>
const $=id=>document.getElementById(id);
const headers=()=>({'Content-Type':'application/json','X-Evia-Token':$('token').value.trim()});
let previousIds=null, replying=new Set(), busy=false;
async function postMessage(device,message){const r=await fetch('/send',{method:'POST',headers:headers(),body:JSON.stringify({device,message})});const d=await r.json();if(!r.ok)throw Error(d.error||'Error '+r.status);return d}
async function refresh(){if(!$('token').value.trim()){$('status').textContent='Introduce el token compartido.';return}if(busy)return;busy=true;try{const r=await fetch('/messages?device='+encodeURIComponent($('device').value.trim()),{headers:headers()});const d=await r.json();if(!r.ok)throw Error(d.error||'Error '+r.status);const current=new Set(d.messages.map(m=>m.id));if(previousIds!==null&&$('autoReply').checked){for(const m of [...d.messages].reverse()){if(!current.has(m.id)||previousIds.has(m.id)||m.device===$('device').value.trim()||/^RECIBIDO(?:\b|:)/i.test(m.message||'')||replying.has(m.id))continue;replying.add(m.id);try{await postMessage($('device').value.trim(),'RECIBIDO: '+(m.device||'dispositivo')+' — mensaje recibido.')}finally{replying.delete(m.id)}}}previousIds=current;$('messages').replaceChildren();for(const m of d.messages){const a=document.createElement('article');a.textContent=(m.device||'dispositivo')+' · '+new Date(m.created_at).toLocaleString()+'\\n'+m.message;$('messages').append(a)}$('status').textContent='Actualizado. Mensajes: '+d.messages.length+( $('autoReply').checked?' · respuesta automática activa':'');}catch(e){$('status').textContent='Error: '+e.message}finally{busy=false}}
$('send').onclick=async()=>{const message=$('message').value.trim(),device=$('device').value.trim();if(!message||!device){$('status').textContent='Escribe un mensaje y el nombre del dispositivo.';return}try{await postMessage(device,message);$('message').value='';$('status').textContent='Mensaje enviado.';await refresh()}catch(e){$('status').textContent='Error: '+e.message}};
$('refresh').onclick=refresh;
setInterval(()=>{if($('token').value.trim())refresh()},10000);
</script></main></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Same-origin app requests do not need CORS. Do not grant arbitrary sites
    // permission to read private messages with a token supplied by the user.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: securityHeaders });
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "Evia Bridge",
        storageConfigured: Boolean(env.EVIA_STORAGE),
        tokenConfigured: Boolean(env.EVIA_BRIDGE_TOKEN)
      });
    }

    if (url.pathname === "/") {
      return new Response(html, {
        headers: {
          ...securityHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        }
      });
    }

    if (!["/send", "/messages"].includes(url.pathname)) {
      return json({ error: "Ruta no encontrada" }, 404);
    }

    const expected = env.EVIA_BRIDGE_TOKEN;
    const provided = request.headers.get("X-Evia-Token");
    if (!expected || !provided || provided !== expected) {
      return json({ error: "No autorizado: revisa el token" }, 401);
    }

    if (!env.EVIA_STORAGE) {
      return json({ error: "Falta configurar el Durable Object EVIA_STORAGE" }, 503);
    }

    if (request.method === "POST") {
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 16_384) return json({ error: "Solicitud demasiado grande" }, 413);
      if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
        return json({ error: "Content-Type debe ser application/json" }, 415);
      }
    } else if (request.method !== "GET") {
      return json({ error: "Método no permitido" }, 405);
    }

    const id = env.EVIA_STORAGE.idFromName("evia-shared-room");
    return env.EVIA_STORAGE.get(id).fetch(
      new Request("https://evia-storage" + url.pathname + url.search, request)
    );
  }
};
