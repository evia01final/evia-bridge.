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
async function api(path, options={}){const r=await fetch(path,{...options,headers:{...headers(),...(options.headers||{})}});const d=await r.json();if(!r.ok)throw Error(d.error||'Error '+r.status);return d}
async function loadAutoReply(){if(!$('token').value.trim()||!$('device').value.trim())return;try{const d=await api('/auto-reply?device='+encodeURIComponent($('device').value.trim()));$('autoReply').checked=!!d.enabled}catch(e){$('status').textContent='Error al consultar respuesta automática: '+e.message}}
$('autoReply').onchange=async()=>{try{await api('/auto-reply',{method:'POST',body:JSON.stringify({device:$('device').value.trim(),enabled:$('autoReply').checked})});$('status').textContent=$('autoReply').checked?'Respuesta automática guardada en el servidor.':'Respuesta automática desactivada.'}catch(e){$('status').textContent='No se pudo guardar la opción: '+e.message;$('autoReply').checked=!$('autoReply').checked}};
async function postMessage(device,message){return api('/send',{method:'POST',body:JSON.stringify({device,message})})}
async function refresh(){if(!$('token').value.trim()){$('status').textContent='Introduce el token compartido.';return}try{const d=await api('/messages?device='+encodeURIComponent($('device').value.trim()));$('messages').replaceChildren();for(const m of d.messages){const a=document.createElement('article');a.textContent=(m.device||'dispositivo')+' · '+new Date(m.created_at).toLocaleString()+'\\n'+m.message;$('messages').append(a)}$('status').textContent='Actualizado. Mensajes: '+d.messages.length+($('autoReply').checked?' · respuesta automática del servidor activa':'')}catch(e){$('status').textContent='Error: '+e.message}}
$('send').onclick=async()=>{const message=$('message').value.trim(),device=$('device').value.trim();if(!message||!device){$('status').textContent='Escribe un mensaje y el nombre del dispositivo.';return}try{await postMessage(device,message);$('message').value='';$('status').textContent='Mensaje enviado.';await refresh()}catch(e){$('status').textContent='Error: '+e.message}};
$('refresh').onclick=refresh;
$('token').addEventListener('change',()=>{loadAutoReply();refresh()});
$('device').addEventListener('change',loadAutoReply);
loadAutoReply();setInterval(()=>{if($('token').value.trim())refresh()},10000);
</script></main></body></html>`;

async function coordinate(env) {
  if (!env.OPENAI_API_KEY || !env.EVIA_STORAGE) throw new Error("Missing OPENAI_API_KEY or EVIA_STORAGE binding");
  const id = env.EVIA_STORAGE.idFromName("evia-shared-room");
  const stub = env.EVIA_STORAGE.get(id);
  // Process a small bounded batch per scheduled run to keep execution predictable.
  for (let i = 0; i < 5; i++) {
    const claim = await stub.fetch("https://evia-storage/coordinator/claim", { method: "POST" });
    if (!claim.ok) throw new Error("Could not claim queued message");
    const { message } = await claim.json();
    if (!message) break;
    const userText = String(message.message).replace(/^@Evia\\s*/i, "").slice(0, 3500);
    let answer = "";
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4.1-mini",
          instructions: "Eres Evia, una asistente útil que conversa en español. Responde al mensaje recibido de forma clara, breve y segura. Estás respondiendo dentro de un puente entre dispositivos; no afirmes que eres otra instancia privada de ChatGPT ni que puedes actuar fuera de este servicio.",
          input: userText,
          max_output_tokens: 500
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "OpenAI API error " + response.status);
      answer = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("\\n").trim();
      if (!answer) answer = "No pude generar una respuesta esta vez.";
    } catch (error) {
      answer = "Evia IA: no pude procesar el mensaje (" + String(error.message || error).slice(0, 180) + ").";
    }
    const sent = await stub.fetch("https://evia-storage/coordinator/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Respuesta a " + message.device + ": " + answer })
    });
    if (!sent.ok) throw new Error("Could not save coordinator response");
  }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(coordinate(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: securityHeaders });
    if (url.pathname === "/health") {
      return json({ ok: true, service: "Evia Bridge", storageConfigured: Boolean(env.EVIA_STORAGE), tokenConfigured: Boolean(env.EVIA_BRIDGE_TOKEN), coordinatorConfigured: Boolean(env.OPENAI_API_KEY) });
    }
    if (url.pathname === "/") return new Response(html, { headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
    if (!["/send", "/messages", "/auto-reply"].includes(url.pathname)) return json({ error: "Ruta no encontrada" }, 404);
    const expected = env.EVIA_BRIDGE_TOKEN;
    const provided = request.headers.get("X-Evia-Token");
    if (!expected || !provided || provided !== expected) return json({ error: "No autorizado: revisa el token" }, 401);
    if (!env.EVIA_STORAGE) return json({ error: "Falta configurar el Durable Object EVIA_STORAGE" }, 503);
    if (request.method === "POST") {
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 16384) return json({ error: "Solicitud demasiado grande" }, 413);
      if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) return json({ error: "Content-Type debe ser application/json" }, 415);
    } else if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);
    const id = env.EVIA_STORAGE.idFromName("evia-shared-room");
    return env.EVIA_STORAGE.get(id).fetch(new Request("https://evia-storage" + url.pathname + url.search, request));
  }
};
