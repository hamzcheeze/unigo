import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResidentTracker } from "../src/components/resident-tracker";
import type { DemoScenario } from "../src/components/demo-scenarios";

function render(scenario: DemoScenario) {
  const html = renderToStaticMarkup(createElement(ResidentTracker, { demo: true, initialDemoScenario: scenario }));
  const button = html.match(/<button class="locate-pickup"[\s\S]*?<\/button>/)?.[0];
  const pickupPanel = html.match(/<section class="pickup-panel[\s\S]*?<\/section>/)?.[0];
  assert.ok(button, "nearest-pickup button is present");
  assert.ok(pickupPanel, "pickup panel is present");
  return { html, button, pickupPanel };
}

test("searching keeps the original nearest-pickup button without a status message", () => {
  const { html, button, pickupPanel } = render("searching");
  assert.match(button, /class="locate-pickup"/);
  assert.match(button, /disabled=""/);
  assert.match(button, /จุดขึ้นรถใกล้ฉัน/);
  assert.doesNotMatch(pickupPanel, /กำลังหาตำแหน่งของคุณ/);
  assert.doesNotMatch(html, /class="location-notice"/);
});

test("location errors appear in the top notice while preserving the retryable button", () => {
  for (const [scenario, message] of [
    ["denied", "ยังไม่ได้อนุญาตตำแหน่ง เลือกจุดขึ้นรถเองได้"],
    ["location-unavailable", "หาตำแหน่งไม่ได้ ลองใหม่หรือเลือกจุดขึ้นรถเอง"],
  ] satisfies [DemoScenario, string][]) {
    const { html, button } = render(scenario);
    assert.match(html, new RegExp(`<div class="location-notice" role="status">${message}</div>`));
    assert.match(button, /class="locate-pickup"/);
    assert.match(button, /จุดขึ้นรถใกล้ฉัน/);
    assert.doesNotMatch(button, /disabled=""/);
  }
});

test("idle and successful location states restore the original enabled label", () => {
  for (const scenario of ["initial", "estimated"] satisfies DemoScenario[]) {
    const { html, button } = render(scenario);
    assert.match(button, /class="locate-pickup"/);
    assert.match(button, /จุดขึ้นรถใกล้ฉัน/);
    assert.doesNotMatch(button, /disabled=""/);
    assert.doesNotMatch(html, /class="location-notice"/);
  }
});
