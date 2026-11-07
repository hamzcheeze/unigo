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

test("routing rejects malformed storage and provider data and expires cached results", async (t) => {
  const names = ["TOMTOM_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  const previous = names.map(name => ({ name, value: process.env[name] }));
  t.after(() => { for (const { name, value } of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  let now = Date.now() + 60000;
  t.mock.method(Date, "now", () => now);
  process.env.TOMTOM_API_KEY = "test-only";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.test/";
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  const input = { vehicleId: "SHUTTLE-02", stopId: "tha-phra" };
  const position = () => ({ vehicle_id: "SHUTTLE-02", revision: 9, session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sequence: 2, latitude: 13.65, longitude: 100.40, accuracy_meters: 50, speed_meters_per_second: 1, bearing_degrees: 359.8, captured_at: new Date(now).toISOString(), received_at: new Date(now).toISOString() });
  const provider = { routes: [{ summary: { lengthInMeters: 100, travelTimeInSeconds: 60 }, legs: [{ points: [{ latitude: 13.65, longitude: 100.40 }, { latitude: 13.73, longitude: 100.47 }] }] }] };
  let storageReply = () => Response.json([position()]);
  let providerReply = () => Response.json(provider);
  let calls = 0;
  const headings: Array<string | null> = [];
  const snapshotKeys: Array<string | null> = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    if (String(url).startsWith("https://storage.test")) {
      snapshotKeys.push(new Headers(init?.headers).get("apikey"));
      return storageReply();
    }
    calls++;
    headings.push(new URL(String(url)).searchParams.get("vehicleHeading"));
    return providerReply();
  });
  for (const body of [null, {}, { ...input, stopId: "unknown" }, { ...input, vehicleId: "SHUTTLE-04" }, { ...input, extra: true }]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls, 0);
  const storageCases = [
    { reply: () => Response.json([]), status: 409, error: "vehicle_unavailable" },
    { reply: () => Response.json([{}]), status: 503, error: "storage_unavailable" },
    { reply: () => Response.json([{ ...position(), vehicle_id: "SHUTTLE-03" }]), status: 409, error: "vehicle_unavailable" },
    { reply: () => Response.json([position(), position()]), status: 503, error: "storage_unavailable" },
    { reply: () => Response.json([{ ...position(), received_at: new Date(now - 10001).toISOString() }]), status: 409, error: "vehicle_unavailable" },
    { reply: () => Response.json([{ ...position(), accuracy_meters: null }]), status: 422, error: "vehicle_position_inaccurate" },
    { reply: () => Response.json([{ ...position(), longitude: 100.550001 }]), status: 422, error: "vehicle_outside_service_area" },
    { reply: () => new Response("private", { status: 500 }), status: 503, error: "storage_unavailable" },
    { reply: () => new Response("{"), status: 503, error: "storage_unavailable" },
    { reply: () => new Response(null), status: 503, error: "storage_unavailable" },
    { reply: () => new Response("x".repeat(2000001)), status: 503, error: "storage_unavailable" },
  ];
  for (const item of storageCases) {
    storageReply = item.reply;
    const response = await POST(request(input));
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { error: item.error });
  }
  assert.equal(calls, 0);
  storageReply = () => Response.json([position()]);
  const providerCases = [
    { reply: () => Response.json({ routes: [] }), status: 404, error: "route_not_found" },
    { reply: () => Response.json({ routes: [{ summary: { lengthInMeters: -1, travelTimeInSeconds: 60 }, legs: [] }] }), status: 404, error: "route_not_found" },
    { reply: () => Response.json({ routes: [{ ...provider.routes[0], summary: { lengthInMeters: 1000001, travelTimeInSeconds: 60 } }] }), status: 503, error: "routing_unavailable" },
    { reply: () => new Response("private", { status: 403 }), status: 503, error: "routing_unavailable" },
    { reply: () => new Response("{"), status: 503, error: "routing_unavailable" },
    { reply: () => new Response(null), status: 503, error: "routing_unavailable" },
    { reply: () => new Response("x".repeat(2000001)), status: 503, error: "routing_unavailable" },
    { reply: (): Response => { throw new Error("network secret"); }, status: 503, error: "routing_unavailable" },
  ];
  for (const item of providerCases) {
    now += 30001;
    providerReply = item.reply;
    const response = await POST(request(input));
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { error: item.error });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, providerCases.length);
  assert.equal(headings.every(heading => heading === null), true);
  providerReply = () => Response.json(provider);
  now += 30001;
  const accepted = await POST(request(input));
  assert.equal(accepted.status, 200);
  const route = routeResponseSchema.parse(await accepted.json());
  assert.equal(route.sourceRevision, 9);
  assert.equal(route.vehicleId, "SHUTTLE-02");
  assert.equal(route.stopId, "tha-phra");
  assert.deepEqual(route.points, [[13.65, 100.40], [13.73, 100.47]]);
  const beforeCache = calls;
  now += 29999;
  assert.equal((await POST(request(input))).status, 200);
  assert.equal(calls, beforeCache);
  now += 1;
  assert.equal((await POST(request(input))).status, 200);
  assert.equal(calls, beforeCache + 1);
  assert.equal(snapshotKeys.every(key => key === "anon-test-key"), true);
});
