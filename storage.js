const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

export class EviaStorage {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS auto_reply (device TEXT PRIMARY KEY, enabled INTEGER NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        device TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      this.ctx.storage.sql.exec(
        "DELETE FROM messages WHERE created_at < ?",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      );
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: securityHeaders });
    }

    if (url.pathname === "/auto-reply" && request.method === "GET") {
      const device = (url.searchParams.get("device") || "").trim().slice(0, 40);
      if (!device) return json({ error: "Falta dispositivo" }, 400);
      const rows = this.ctx.storage.sql.exec("SELECT enabled FROM auto_reply WHERE device = ?", device);
      return json({ enabled: rows.toArray().length > 0 && rows.toArray()[0].enabled === 1 });
    }

    if (url.pathname === "/auto-reply" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "JSON inválido" }, 400); }
      const device = typeof body?.device === "string" ? body.device.trim().slice(0, 40) : "";
      if (!device || typeof body.enabled !== "boolean") return json({ error: "Falta dispositivo o estado" }, 400);
      this.ctx.storage.sql.exec("INSERT INTO auto_reply (device, enabled) VALUES (?, ?) ON CONFLICT(device) DO UPDATE SET enabled = excluded.enabled", device, body.enabled ? 1 : 0);
      return json({ ok: true, device, enabled: body.enabled });
    }

    if (url.pathname === "/send" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON inválido" }, 400);
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ error: "El cuerpo debe ser un objeto JSON" }, 400);
      }

      const device = typeof body.device === "string" ? body.device.trim().slice(0, 40) : "";
      const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
      if (!device || !message) {
        return json({ error: "Falta dispositivo o mensaje" }, 400);
      }

      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      this.ctx.storage.sql.exec(
        "INSERT INTO messages (id, device, message, created_at) VALUES (?, ?, ?, ?)",
        id, device, message, created_at
      );

      this.ctx.storage.sql.exec(
        "DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY created_at DESC LIMIT -1 OFFSET 1000)"
      );

      // Server-side acknowledgements do not depend on a browser polling in the background.
      if (!/^RECIBIDO(?:\b|:)/i.test(message)) {
        const enabled = this.ctx.storage.sql.exec("SELECT device FROM auto_reply WHERE enabled = 1").toArray();
        for (const row of enabled) {
          if (row.device === device) continue;
          const ackId = crypto.randomUUID();
          this.ctx.storage.sql.exec(
            "INSERT INTO messages (id, device, message, created_at) VALUES (?, ?, ?, ?)",
            ackId, row.device, "RECIBIDO: " + device + " — mensaje recibido.", new Date().toISOString()
          );
        }
      }
      return json({ ok: true, id, created_at });
    }

    if (url.pathname === "/messages" && request.method === "GET") {
      const device = (url.searchParams.get("device") || "").slice(0, 40);
      const rows = this.ctx.storage.sql.exec(
        "SELECT id, device, message, created_at FROM messages ORDER BY created_at DESC LIMIT 100"
      );
      const messages = [...rows].filter(m => m.device !== device);
      return json({ messages });
    }

    return json({ error: "Ruta no encontrada" }, 404);
  }
}
