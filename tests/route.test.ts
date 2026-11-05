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

test("receiver rejects missing config, cross-vehicle auth, malformed, oversized, stale and mock requests", async () => {
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
