import { test } from "node:test";
import assert from "node:assert/strict";
import { requestResidentLocation } from "../src/lib/resident-location";

type GeolocationApi = Pick<Geolocation, "getCurrentPosition">;
const position = (timestamp = Date.now()): GeolocationPosition => ({
  timestamp,
  coords: { latitude: 13.72, longitude: 100.47, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
  toJSON: () => ({}),
});
const unavailable: GeolocationPositionError = { code: 2, message: "unavailable", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("a valid device fix ends the search on the first attempt", async () => {
  let calls = 0;
  const fix = position();
  const geolocation: GeolocationApi = { getCurrentPosition(success, _error, options) {
    calls++;
    assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 3000 });
    success(fix);
  } };
  assert.deepEqual(await requestResidentLocation({ geolocation, signal: new AbortController().signal }), {
    kind: "located", latitude: 13.72, longitude: 100.47, accuracy: 5, timestamp: fix.timestamp,
  });
  assert.equal(calls, 1);
});

test("unavailable and stale fixes retry up to the third successful attempt", async () => {
  let calls = 0;
  const geolocation: GeolocationApi = { getCurrentPosition(success, error) {
    calls++;
    if (calls === 1) error?.(unavailable);
    else success(position(calls === 2 ? Date.now() - 60001 : Date.now()));
  } };
  const result = await requestResidentLocation({ geolocation, signal: new AbortController().signal });
  assert.equal(result.kind, "located");
  assert.equal(calls, 3);
});

test("each attempt has a hard three-second deadline even if the browser never responds", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const geolocation: GeolocationApi = { getCurrentPosition() { calls++; } };
  const request = requestResidentLocation({ geolocation, signal: new AbortController().signal });
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(calls, attempt);
    context.mock.timers.tick(2999);
    await flush();
    assert.equal(calls, attempt);
    context.mock.timers.tick(1);
    await flush();
  }
  assert.deepEqual(await request, { kind: "unavailable" });
  assert.equal(calls, 3);
  context.mock.timers.tick(30000);
  await flush();
  assert.equal(calls, 3);
});

test("late callbacks from a timed-out attempt cannot replace the next result", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const callbacks: PositionCallback[] = [];
  const geolocation: GeolocationApi = { getCurrentPosition(success) { callbacks.push(success); } };
  const request = requestResidentLocation({ geolocation, signal: new AbortController().signal });
  context.mock.timers.tick(3000);
  await flush();
  assert.equal(callbacks.length, 2);
  callbacks[0](position());
  callbacks[1]({ ...position(), coords: { ...position().coords, latitude: 13.73 } });
  const result = await request;
  assert.equal(result.kind, "located");
  if (result.kind === "located") assert.equal(result.latitude, 13.73);
});

test("permission denial stops immediately instead of prompting repeatedly", async () => {
  let calls = 0;
  const geolocation: GeolocationApi = { getCurrentPosition(_success, error) {
    calls++;
    error?.({ ...unavailable, code: 1 });
  } };
  assert.deepEqual(await requestResidentLocation({ geolocation, signal: new AbortController().signal }), { kind: "denied" });
  assert.equal(calls, 1);
});

test("cancelling a search stops retries and ignores a late device fix", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const callbacks: PositionCallback[] = [];
  const controller = new AbortController();
  const geolocation: GeolocationApi = { getCurrentPosition(success) { callbacks.push(success); } };
  const request = requestResidentLocation({ geolocation, signal: controller.signal });
  controller.abort();
  assert.deepEqual(await request, { kind: "cancelled" });
  callbacks[0](position());
  context.mock.timers.tick(30000);
  await flush();
  assert.equal(callbacks.length, 1);
});
