const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Evia-Token"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}
export class EviaStorage {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        device TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
    });
  }
  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    if (url.pathname === "/send" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "JSON inválido" }, 400); }
      const device = String(body.device || "").trim().slice(0, 40);
      const message = String(body.message || "").trim().slice(0, 4000);
      if (!device || !message) return json({ error: "Falta dispositivo o mensaje" }, 400);
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      this.ctx.storage.sql.exec(
        "INSERT INTO messages (id, device, message, created_at) VALUES (?, ?, ?, ?)",
        id, device, message, created_at
      );
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
