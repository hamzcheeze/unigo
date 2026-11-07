import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDriver, boundedJson, parseDriverTokens } from "../src/lib/ingestion";

const tokens = { "SHUTTLE-01": "a".repeat(32), "SHUTTLE-02": "b".repeat(32), "SHUTTLE-03": "c".repeat(256) };
test("driver token configuration accepts length boundaries and rejects malformed, shared and incomplete tokens", () => {
  assert.deepEqual(parseDriverTokens(JSON.stringify(tokens)), tokens);
  for (const raw of [undefined, "", "{", "null", "[]", JSON.stringify({}), JSON.stringify({ ...tokens, "SHUTTLE-01": "a".repeat(31) }), JSON.stringify({ ...tokens, "SHUTTLE-03": "c".repeat(257) }), JSON.stringify({ ...tokens, "SHUTTLE-02": tokens["SHUTTLE-01"] }), JSON.stringify({ ...tokens, "SHUTTLE-01": "a".repeat(31) + "+" })]) {
    assert.equal(parseDriverTokens(raw), null, String(raw));
  }
  const allowed = { ...tokens, "SHUTTLE-01": "A_0-".repeat(8) };
  assert.deepEqual(parseDriverTokens(JSON.stringify(allowed)), allowed);
});

test("authorization binds exact case-sensitive bearer token to its vehicle", () => {
  assert.equal(authorizeDriver(`Bearer ${tokens["SHUTTLE-01"]}`, "SHUTTLE-01", tokens), true);
  assert.equal(authorizeDriver(`Bearer ${tokens["SHUTTLE-03"]}`, "SHUTTLE-03", tokens), true);
  for (const header of [null, "", "Bearer ", `bearer ${tokens["SHUTTLE-01"]}`, `Bearer ${tokens["SHUTTLE-02"]}`, `Bearer ${tokens["SHUTTLE-01"]} `, `Bearer ${"x".repeat(294)}`]) {
    assert.equal(authorizeDriver(header, "SHUTTLE-01", tokens), false);
  }
});

test("bounded JSON accepts exactly 8192 UTF-8 bytes and rejects one byte over", async () => {
  assert.equal(await boundedJson(new Request("http://test", { method: "POST", body: JSON.stringify("x".repeat(8190)) })), "x".repeat(8190));
  await assert.rejects(boundedJson(new Request("http://test", { method: "POST", body: JSON.stringify("x".repeat(8191)) })), /body_too_large/);
  await assert.rejects(boundedJson(new Request("http://test", { method: "POST", body: JSON.stringify("ก".repeat(2731)) })), /body_too_large/);
});

test("bounded JSON joins split UTF-8 chunks and releases its reader", async () => {
  const bytes = new TextEncoder().encode('{"name":"ก"}');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 10)); controller.enqueue(bytes.slice(10)); controller.close(); } });
  const init = { method: "POST", body: stream, duplex: "half" };
  const request = new Request("http://test", init);
  assert.deepEqual(await boundedJson(request), { name: "ก" });
  assert.equal(request.body?.locked, false);
});

test("bounded JSON rejects empty, invalid JSON, invalid UTF-8 and read errors", async () => {
  await assert.rejects(boundedJson(new Request("http://test")), /invalid_body/);
  for (const body of ["", "{"]) await assert.rejects(boundedJson(new Request("http://test", { method: "POST", body })), SyntaxError);
  await assert.rejects(boundedJson(new Request("http://test", { method: "POST", body: new Uint8Array([0xff]) })), TypeError);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("read_failed")); } });
  const init = { method: "POST", body: stream, duplex: "half" };
  const request = new Request("http://test", init);
  await assert.rejects(boundedJson(request), /read_failed/);
  assert.equal(request.body?.locked, false);
});

test("oversized streaming bodies cancel the reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { cancelled = true; } });
  const init = { method: "POST", body: stream, duplex: "half" };
  const request = new Request("http://test", init);
  await assert.rejects(boundedJson(request), /body_too_large/);
  assert.equal(cancelled, true);
  assert.equal(request.body?.locked, false);
});
