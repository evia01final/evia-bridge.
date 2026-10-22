

const cors = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",

  "Access-Control-Allow-Headers": "Content-Type, X-Evia-Token"

};

function json(data, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" }

  });

}

export class EviaStorage {

  constructor(ctx, env) {

    this.ctx = ctx;

    this.env = env;

    this.ctx.blockConcurrencyWhile(async () => {

      await this.ctx.storage.sql.exec(`

        CREATE TABLE IF NOT EXISTS messages (

          id TEXT PRIMARY KEY,

          device TEXT NOT NULL,

          message TEXT NOT NULL,

          created_at TEXT NOT NULL

        )

      `);

    });

  }

  async fetch(request) {

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {

      return new Response(null, { headers: cors });

    }

    if (url.pathname === "/send" && request.method === "POST") {

      let body;

      try {

        body = await request.json();

      } catch {

        return json({ error: "JSON inválido" }, 400);

      }

      const device = String(body.device || "").trim().slice(0, 40);

      const message = String(body.message || "").trim().slice(0, 4000);

      if (!device || !message) {

        return json({ error: "Falta dispositivo o mensaje" }, 400);

      }

      const id = crypto.randomUUID();

      const createdAt = new Date().toISOString();

      this.ctx.storage.sql.exec(

        "INSERT INTO messages (id, device, message, created_at) VALUES (?, ?, ?, ?)",

        id, device, message, createdAt

      );

      return json({ ok: true, id, createdAt });

    }

    if (url.pathname === "/messages" && request.method === "GET") {

      const device = url.searchParams.get("device") || "";

      const result = this.ctx.storage.sql.exec(

        "SELECT id, device, message, created_at FROM messages ORDER BY created_at DESC LIMIT 100"

      );

      const messages = [...result].filter(item => item.device !== device);

      return json({ messages });

    }

    if (url.pathname === "/health") {

      return json({ ok: true, service: "Evia Bridge" });

    }

    return json({ error: "Ruta no encontrada" }, 404);

  }

}

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {

      return new Response(null, { headers: cors });

    }

    if (url.pathname === "/") {

      return new Response(

        "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Evia Bridge</title><h1>Evia Bridge</h1><p>Puente de mensajes disponible.</p><p>Usa /health para comprobar el servicio.</p></html>",

        { headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } }

      );

    }

    if (url.pathname !== "/health") {

      const expected = env.EVIA_BRIDGE_TOKEN;

      const provided = request.headers.get("X-Evia-Token");

      if (!expected || !provided || provided !== expected) {

        return json({ error: "No autorizado" }, 401);

      }

    }

    if (url.pathname === "/health") {

      return json({ ok: true, service: "Evia Bridge" });

    }

    const id = env.EVIA_STORAGE.idFromName("evia-shared-room");

    const stub = env.EVIA_STORAGE.get(id);

    return stub.fetch(new Request(

      "https://evia-storage" + url.pathname + url.search,

      request

    ));

  }

};
