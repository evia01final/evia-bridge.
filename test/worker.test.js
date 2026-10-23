import test from "node:test";
import assert from "node:assert/strict";
import worker from "../index.js";

const configuredEnv = {
  EVIA_BRIDGE_TOKEN: "test-secret-token",
  EVIA_STORAGE: {
    idFromName(name) {
      assert.equal(name, "evia-shared-room");
      return "test-id";
    },
    get() {
      return { fetch: async request => new Response(JSON.stringify({
        forwardedPath: new URL(request.url).pathname,
        method: request.method
      }), { headers: { "Content-Type": "application/json" } }) };
    }
  }
};

test("health reports configured bindings without revealing the secret", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), configuredEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "Evia Bridge",
    storageConfigured: true,
    tokenConfigured: true,
    coordinatorConfigured: false
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("homepage returns security headers and HTML", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), configuredEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(await response.text(), /Evia Bridge/);
});

test("send endpoint rejects missing or incorrect token", async () => {
  for (const token of [null, "wrong-token"]) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) headers.set("X-Evia-Token", token);
    const response = await worker.fetch(new Request("https://example.test/send", {
      method: "POST", headers, body: JSON.stringify({ device: "iphone", message: "test" })
    }), configuredEnv);
    assert.equal(response.status, 401);
  }
});

test("authorized requests are forwarded to the Durable Object", async () => {
  const response = await worker.fetch(new Request("https://example.test/messages?device=iphone", {
    headers: { "X-Evia-Token": configuredEnv.EVIA_BRIDGE_TOKEN }
  }), configuredEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { forwardedPath: "/messages", method: "GET" });
});

test("unknown routes return 404", async () => {
  const response = await worker.fetch(new Request("https://example.test/nope"), configuredEnv);
  assert.equal(response.status, 404);
});

test("POST requires JSON content type", async () => {
  const response = await worker.fetch(new Request("https://example.test/send", {
    method: "POST",
    headers: { "X-Evia-Token": configuredEnv.EVIA_BRIDGE_TOKEN, "Content-Type": "text/plain" },
    body: "hello"
  }), configuredEnv);
  assert.equal(response.status, 415);
});
