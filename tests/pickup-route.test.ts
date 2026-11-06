import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/route/route";
import { routeResponseSchema } from "../src/lib/pickups";

const request = (body: unknown) => new Request("http://localhost/api/route", { method: "POST", body: JSON.stringify(body) });
test("routing validates requests and snapshots, converts geometry, coalesces requests and fails closed", async () => {
  const names = ["TOMTOM_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previous = names.map((name) => ({ name, value: process.env[name] }));
  const originalFetch = globalThis.fetch;
  const input = { vehicleId: "SHUTTLE-01", stopId: "tha-phra" };
  const position = { vehicle_id: "SHUTTLE-01", revision: 1, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 1, latitude: 13.72, longitude: 100.47, accuracy_meters: 5, speed_meters_per_second: 3, bearing_degrees: 180, captured_at: new Date().toISOString(), received_at: new Date().toISOString() };
  let upstreamCalls = 0;
  let upstreamFails = false;
  try {
    delete process.env.TOMTOM_API_KEY;
    assert.equal((await POST(request({ ...input, latitude: 0 }))).status, 400);
    assert.deepEqual(await (await POST(request(input))).json(), { error: "routing_not_configured" });
    process.env.TOMTOM_API_KEY = "test-only";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-only";
    globalThis.fetch = async (url) => {
      if (String(url).startsWith("https://storage.example.test")) return Response.json([position]);
      upstreamCalls++;
      const parsed = new URL(String(url));
      assert.equal(parsed.hostname, "api.tomtom.com");
      assert.equal(parsed.searchParams.get("traffic"), "true");
      assert.equal(parsed.searchParams.get("vehicleHeading"), "180");
      if (upstreamFails) return Response.json({ secret: "must not leak" }, { status: 429 });
      return Response.json({ routes: [{ summary: { lengthInMeters: 1234, travelTimeInSeconds: 321 }, legs: [{ points: [{ latitude: 13.72, longitude: 100.47 }, { latitude: 13.730175, longitude: 100.473615 }] }] }] });
    };
    position.captured_at = new Date(Date.now() - 30000).toISOString();
    assert.equal((await POST(request(input))).status, 409);
    position.captured_at = new Date().toISOString();
    position.accuracy_meters = 51;
    assert.equal((await POST(request(input))).status, 422);
    position.accuracy_meters = 5;
    position.latitude = 14;
    assert.deepEqual(await (await POST(request(input))).json(), { error: "vehicle_outside_service_area" });
    position.latitude = 13.72;
    const responses = await Promise.all([POST(request(input)), POST(request(input))]);
    assert.equal(upstreamCalls, 1);
    const route = routeResponseSchema.parse(await responses[0].json());
    assert.deepEqual(route.points, [[13.72, 100.47], [13.730175, 100.473615]]);
    assert.equal(route.durationSeconds, 321);
    assert.equal(route.distanceMeters, 1234);
    assert.equal(route.trafficAware, true);
    position.captured_at = new Date(Date.now() - 30000).toISOString();
    assert.equal((await POST(request(input))).status, 409);
    position.captured_at = new Date().toISOString();
    upstreamFails = true;
    const failed = await POST(request({ ...input, stopId: "talat-phlu" }));
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: "routing_unavailable" });
    await POST(request({ ...input, stopId: "talat-phlu" }));
    assert.equal(upstreamCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const { name, value } of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
