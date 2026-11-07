import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/positions/route";

const payload = {
  vehicleId: "SHUTTLE-01", sessionId: "a0000000-0000-4000-8000-000000000001", sequence: 1,
  latitude: 13.73, longitude: 100.47, capturedAtMs: Date.now(), elapsedRealtimeNanos: 1000,
  provider: "gps", accuracyMeters: 5, speedMetersPerSecond: null, bearingDegrees: null, mock: false,
};
const tokens = { "SHUTTLE-01": "a".repeat(43), "SHUTTLE-02": "b".repeat(43), "SHUTTLE-03": "c".repeat(43) };
const request = (body: unknown, token = tokens["SHUTTLE-01"]) => new Request("https://example.test/api/positions", {
  method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});

test("receiver rejects missing config, cross-vehicle auth, malformed, oversized, stale and mock requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("test storage unavailable"); });
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DRIVER_TOKENS_JSON"];
  const previous = keys.map((key) => [key, process.env[key]]);
  try {
    delete process.env.DRIVER_TOKENS_JSON;
    assert.equal((await POST(request(payload))).status, 503);
    process.env.DRIVER_TOKENS_JSON = JSON.stringify(tokens);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "local-test-only-not-a-hosted-key";
    assert.equal((await POST(request(payload, tokens["SHUTTLE-02"]))).status, 401);
    assert.equal((await POST(request({ ...payload, longitude: 181 }))).status, 400);
    assert.equal((await POST(request({ ...payload, padding: "x".repeat(9000) }))).status, 413);
    assert.equal((await POST(request({ ...payload, capturedAtMs: Date.now() - 16000 }))).status, 422);
    assert.equal((await POST(request({ ...payload, capturedAtMs: Date.now(), mock: true }))).status, 422);
    const unavailable = await POST(request({ ...payload, capturedAtMs: Date.now() }));
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "no-store");
    assert.deepEqual(await unavailable.json(), { error: "storage_unavailable" });
  } finally {
    for (const [name, value] of previous) {
      if (typeof name !== "string") continue;
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("receiver maps committed, rejected and broken storage replies without leaking upstream errors", async (t) => {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DRIVER_TOKENS_JSON"];
  const previous = names.map(name => ({ name, value: process.env[name] }));
  t.after(() => { for (const { name, value } of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.test/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.DRIVER_TOKENS_JSON = JSON.stringify(tokens);
  const cases = [
    { storage: () => Response.json({ accepted: true, revision: 7 }), status: 200, body: { accepted: true, revision: 7 } },
    { storage: () => Response.json({ accepted: false, reason: "out_of_order" }), status: 409, body: { error: "out_of_order" } },
    ...[{}, { accepted: true, revision: 0 }, { accepted: true, revision: 1.5 }, { accepted: false }, { accepted: "true", revision: 1 }].map(body => ({ storage: () => Response.json(body), status: 503, body: { error: "storage_unavailable" } })),
    { storage: () => new Response("private detail", { status: 500 }), status: 503, body: { error: "storage_unavailable" } },
    { storage: () => new Response("not json"), status: 503, body: { error: "storage_unavailable" } },
    { storage: (): Response => { throw new Error("private network detail"); }, status: 503, body: { error: "storage_unavailable" } },
  ];
  for (const item of cases) {
    const current = { ...payload, capturedAtMs: Date.now(), unknownField: "stripped" };
    let observedUrl: unknown;
    let observedInit: RequestInit | undefined;
    const mock = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
      observedUrl = url;
      observedInit = init;
      return item.storage();
    });
    const response = await POST(request(current));
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), item.body);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(observedUrl, "https://storage.test/rest/v1/rpc/ingest_position");
    assert.equal(observedInit?.method, "POST");
    assert.equal(observedInit?.cache, "no-store");
    assert.deepEqual(observedInit?.headers, { apikey: "test-service-key", Authorization: "Bearer test-service-key", "Content-Type": "application/json" });
    const { unknownField, ...expected } = current;
    assert.deepEqual(JSON.parse(String(observedInit?.body)), { p_position: expected });
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
  const malformed = await POST(new Request("http://test", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_json" });
  const future = await POST(request({ ...payload, capturedAtMs: Date.now() + 10000 }));
  assert.equal(future.status, 422);
  assert.deepEqual(await future.json(), { error: "future_position" });
});
