import assert from "node:assert/strict";
import test from "node:test";
import { matchComponents } from "../lib/component-matcher.js";

const manifest = {
  components: [
    {
      name: "button",
      path: "button/index.vue",
      aliases: ["Button", "ButtonComponent", "ButtonPrimary"],
      props: ["variant", "size"],
    },
    {
      name: "checkbox",
      path: "checkbox/index.vue",
      aliases: ["Checkbox", "CheckboxComponent"],
      props: ["checked"],
    },
    {
      name: "input-slider",
      path: "input-slider/index.vue",
      aliases: ["InputSlider", "Slider"],
      props: ["min", "max", "value"],
    },
    {
      name: "color-picker",
      path: "color-picker/index.vue",
      aliases: ["ColorPicker"],
      props: ["color"],
    },
  ],
};

const instances = [
  { id: "1:1", name: "Button", componentId: "c1" },
  { id: "1:2", name: "Checkbox", componentId: "c2" },
  { id: "1:3", name: "Unknown Widget", componentId: "c3" },
  { id: "1:4", name: "Slider", componentId: "c4" },
  { id: "1:5", name: "Color Picker", componentId: "c5" },
];

test("exact name match (case-insensitive)", () => {
  const results = matchComponents([{ id: "1:1", name: "button" }], manifest);

  assert.equal(results[0].match.name, "button");
  assert.equal(results[0].match.confidence, 0.95);
});

test("alias match", () => {
  const results = matchComponents([{ id: "1:4", name: "Slider" }], manifest);

  assert.equal(results[0].match.name, "input-slider");
  assert.equal(results[0].match.confidence, 0.9);
});

test("fuzzy match via normalized name", () => {
  const results = matchComponents(
    [{ id: "1:5", name: "Color Picker" }],
    manifest,
  );

  assert.ok(results[0].match !== null);
  assert.equal(results[0].match.name, "color-picker");
});

test("no match for unrelated instance", () => {
  const results = matchComponents(
    [{ id: "1:3", name: "Unknown Widget" }],
    manifest,
  );

  assert.equal(results[0].match, null);
});

test("matches multiple instances", () => {
  const results = matchComponents(instances, manifest);

  assert.equal(results.length, 5);
  assert.ok(results[0].match !== null);
  assert.ok(results[1].match !== null);
  assert.equal(results[2].match, null);
  assert.ok(results[3].match !== null);
  assert.ok(results[4].match !== null);
});

test("returns empty for null manifest", () => {
  assert.deepEqual(matchComponents(instances, null), []);
});

test("returns empty for manifest with no components", () => {
  assert.deepEqual(matchComponents(instances, { components: [] }), []);
});

test("exact match takes priority over fuzzy", () => {
  const results = matchComponents([{ id: "1:1", name: "Button" }], manifest);

  assert.equal(results[0].match.confidence, 0.95);
});

test("Figma-style slash names match", () => {
  const results = matchComponents(
    [{ id: "1:1", name: "Button / Primary" }],
    manifest,
  );

  assert.ok(results[0].match !== null);
  assert.equal(results[0].match.name, "button");
});
