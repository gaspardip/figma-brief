import assert from "node:assert/strict";
import test from "node:test";
import { classifyChildFrames } from "../lib/frame-classifier.js";

test("classifies large frames as screens", () => {
  const node = {
    children: [
      {
        id: "1:1",
        name: "toast state",
        type: "FRAME",
        absoluteBoundingBox: { width: 1440, height: 1024 },
      },
      {
        id: "1:2",
        name: "modal state",
        type: "FRAME",
        absoluteBoundingBox: { width: 1440, height: 1024 },
      },
    ],
  };

  const result = classifyChildFrames(node);

  assert.equal(result.screens.length, 2);
  assert.equal(result.screens[0].name, "toast state");
  assert.equal(result.annotations.length, 0);
  assert.equal(result.other.length, 0);
});

test("classifies small instances as annotations", () => {
  const node = {
    children: [
      {
        id: "2:1",
        name: "annotation",
        type: "INSTANCE",
        absoluteBoundingBox: { width: 367, height: 290 },
      },
      {
        id: "2:2",
        name: "callout",
        type: "INSTANCE",
        absoluteBoundingBox: { width: 200, height: 150 },
      },
    ],
  };

  const result = classifyChildFrames(node);

  assert.equal(result.screens.length, 0);
  assert.equal(result.annotations.length, 2);
});

test("classifies vectors and small elements as other", () => {
  const node = {
    children: [
      {
        id: "3:1",
        name: "Arrow",
        type: "VECTOR",
        absoluteBoundingBox: { width: 100, height: 50 },
      },
      {
        id: "3:2",
        name: "Line",
        type: "LINE",
        absoluteBoundingBox: { width: 500, height: 1 },
      },
    ],
  };

  const result = classifyChildFrames(node);

  assert.equal(result.other.length, 2);
  assert.equal(result.screens.length, 0);
});

test("returns empty arrays for null or empty node", () => {
  assert.deepEqual(classifyChildFrames(null), {
    screens: [],
    annotations: [],
    other: [],
  });
  assert.deepEqual(classifyChildFrames({ children: [] }), {
    screens: [],
    annotations: [],
    other: [],
  });
  assert.deepEqual(classifyChildFrames({}), {
    screens: [],
    annotations: [],
    other: [],
  });
});

test("respects custom thresholds", () => {
  const node = {
    children: [
      {
        id: "4:1",
        name: "small screen",
        type: "FRAME",
        absoluteBoundingBox: { width: 900, height: 700 },
      },
    ],
  };

  const defaultResult = classifyChildFrames(node);
  assert.equal(defaultResult.screens.length, 1);

  const strictResult = classifyChildFrames(node, {
    minScreenWidth: 1000,
    minScreenHeight: 800,
  });
  assert.equal(strictResult.screens.length, 0);
  assert.equal(strictResult.other.length, 1);
});

test("does not recurse into grandchildren", () => {
  const node = {
    children: [
      {
        id: "5:1",
        name: "parent",
        type: "FRAME",
        absoluteBoundingBox: { width: 1440, height: 1024 },
        children: [
          {
            id: "5:2",
            name: "nested screen",
            type: "FRAME",
            absoluteBoundingBox: { width: 1440, height: 1024 },
          },
        ],
      },
    ],
  };

  const result = classifyChildFrames(node);

  assert.equal(result.screens.length, 1);
  assert.equal(result.screens[0].nodeId, "5:1");
});
