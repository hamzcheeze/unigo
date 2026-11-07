import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/usb-positions/route";

test("USB preview stays local and streams only an available bridge", async t => {
  const previous = { NODE_ENV: process.env.NODE_ENV, GOGO_USB_PREVIEW: process.env.GOGO_USB_PREVIEW };
  try {
    for (const [mode, preview, host] of [
      ["production", "1", "localhost"], ["test", "1", "localhost"],
      ["development", "0", "localhost"], ["development", "1", "example.test"],
      ["development", "1", "localhost.example.test"], ["development", "1", "127.0.0.2"],
    ]) {
      await t.test(`rejects ${mode}/${preview}/${host}`, async context => {
        Object.assign(process.env, { NODE_ENV: mode, GOGO_USB_PREVIEW: preview });
        const fetchMock = context.mock.method(globalThis, "fetch", () => { throw new Error("unexpected_network"); });
        const response = await GET(new Request(`http://${host}:3000/api/usb-positions`));
        assert.equal(response.status, 404);
        assert.equal(await response.text(), "");
        assert.equal(fetchMock.mock.calls.length, 0);
      });
    }
    Object.assign(process.env, { NODE_ENV: "development", GOGO_USB_PREVIEW: "1" });
    await t.test("rejects a different origin before contacting the bridge", async context => {
      const fetchMock = context.mock.method(globalThis, "fetch", () => { throw new Error("unexpected_network"); });
      const response = await GET(new Request("http://localhost:3000/api/usb-positions", { headers: { origin: "http://localhost:3001" } }));
      assert.equal(response.status, 403);
      assert.equal(fetchMock.mock.calls.length, 0);
    });
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      await t.test(`streams SSE through ${host} and forwards cancellation`, async context => {
        const body = 'data: {"revision":2}\n\n';
        const fetchMock = context.mock.method(globalThis, "fetch", async () => new Response(body));
        const request = new Request(`http://${host}:3000/api/usb-positions`, { headers: { origin: `http://${host}:3000` } });
        const response = await GET(request);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), body);
        assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-accel-buffering"), "no");
        assert.equal(fetchMock.mock.calls[0].arguments[0], "http://127.0.0.1:8787/events");
        assert.equal(fetchMock.mock.calls[0].arguments[1]?.signal, request.signal);
      });
    }
    for (const failure of ["http", "empty", "network"]) {
      await t.test(`returns an honest unavailable response on ${failure} failure`, async context => {
        context.mock.method(globalThis, "fetch", async () => {
          if (failure === "network") throw new Error("offline");
          return failure === "http" ? new Response("down", { status: 500 }) : new Response(null, { status: 204 });
        });
        const response = await GET(new Request("http://localhost:3000/api/usb-positions"));
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "usb_bridge_unavailable" });
        assert.equal(response.headers.get("cache-control"), "no-store");
      });
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
