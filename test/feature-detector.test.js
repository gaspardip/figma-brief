import assert from "node:assert/strict";
import test from "node:test";
import {
  detectFeatures,
  extractFlowNotes,
  selectFeature,
} from "../lib/feature-detector.js";

const pageNode = {
  id: "0:1",
  type: "CANVAS",
  name: "Page 1",
  children: [
    {
      id: "1:1",
      type: "FRAME",
      name: "Feature A",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
      children: [],
    },
    {
      id: "1:2",
      type: "FRAME",
      name: "Feature B",
      absoluteBoundingBox: { x: 500, y: 0, width: 400, height: 300 },
      children: [],
    },
    {
      id: "1:3",
      type: "CONNECTOR",
      connectorStart: { endpointNodeId: "1:1" },
      connectorEnd: { endpointNodeId: "1:2" },
      children: [{ id: "1:4", type: "TEXT", characters: "on submit" }],
    },
    {
      id: "1:5",
      type: "TEXT",
      name: "Page title",
      characters: "Design Spec",
    },
  ],
};

test("detectFeatures finds top-level frames", () => {
  const result = detectFeatures(pageNode);

  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].name, "Feature A");
  assert.equal(result.features[1].name, "Feature B");
  assert.equal(result.isMultiFeature, true);
});

test("detectFeatures extracts connector flows", () => {
  const result = detectFeatures(pageNode);

  assert.equal(result.flows.length, 1);
  assert.equal(result.flows[0].from.name, "Feature A");
  assert.equal(result.flows[0].to.name, "Feature B");
  assert.equal(result.flows[0].label, "on submit");
});

test("detectFeatures skips non-frame children", () => {
  const result = detectFeatures(pageNode);

  const featureIds = result.features.map((f) => f.nodeId);

  assert.ok(!featureIds.includes("1:3"));
  assert.ok(!featureIds.includes("1:5"));
});

test("detectFeatures returns empty for node without children", () => {
  const result = detectFeatures({ id: "1:1", type: "FRAME" });

  assert.deepEqual(result, { features: [], flows: [], isMultiFeature: false });
});

test("detectFeatures handles single-frame page", () => {
  const singlePage = {
    id: "0:1",
    type: "CANVAS",
    children: [
      { id: "2:1", type: "FRAME", name: "Only Feature", children: [] },
    ],
  };

  const result = detectFeatures(singlePage);

  assert.equal(result.features.length, 1);
  assert.equal(result.isMultiFeature, false);
});

test("selectFeature by index", () => {
  const features = [
    { name: "Feature A", nodeId: "1:1" },
    { name: "Feature B", nodeId: "1:2" },
  ];

  assert.equal(selectFeature(features, "0").name, "Feature A");
  assert.equal(selectFeature(features, "1").name, "Feature B");
});

test("selectFeature by name substring", () => {
  const features = [
    { name: "Feature A", nodeId: "1:1" },
    { name: "Feature B", nodeId: "1:2" },
  ];

  assert.equal(selectFeature(features, "feature b").name, "Feature B");
  assert.equal(selectFeature(features, "feature a").name, "Feature A");
});

test("selectFeature returns null for no match", () => {
  const features = [{ name: "Feature A", nodeId: "1:1" }];

  assert.equal(selectFeature(features, "nonexistent"), null);
  assert.equal(selectFeature(features, null), null);
});

test("extractFlowNotes finds connectors between frames", () => {
  const frames = [
    {
      name: "Feature A",
      nodeId: "1:1",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
    },
    {
      name: "Feature B",
      nodeId: "1:2",
      bounds: { x: 500, y: 0, width: 400, height: 300 },
    },
  ];

  const flows = extractFlowNotes(pageNode, frames);

  assert.equal(flows.length, 1);
  assert.equal(flows[0].from.name, "Feature A");
  assert.equal(flows[0].to.name, "Feature B");
  assert.equal(flows[0].label, "on submit");
});
