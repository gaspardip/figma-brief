import assert from "node:assert/strict";
import test from "node:test";
import { buildBrief } from "../lib/brief-builder.js";
import { buildPrompt } from "../lib/prompt-template.js";

const target = {
  figmaUrl: "https://www.figma.com/design/FILE123/Checkout?node-id=12-345",
  fileKey: "FILE123",
  fileName: "Checkout",
  nodeId: "12:345",
};

const node = {
  id: "12:345",
  type: "FRAME",
  name: "Checkout Summary",
  layoutMode: "VERTICAL",
  absoluteBoundingBox: { x: 100, y: 100, width: 320, height: 200 },
  children: [
    {
      id: "12:346",
      type: "TEXT",
      name: "Note",
      characters: "A11Y: Preserve focus ring",
    },
    {
      id: "12:347",
      type: "INSTANCE",
      name: "Button / Primary",
      componentId: "1:22",
      absoluteBoundingBox: { x: 120, y: 220, width: 120, height: 40 },
      children: [],
    },
  ],
};

const rawNodePayload = {
  components: {
    "1:22": {
      key: "button-primary",
      name: "Button / Primary",
      description: "Primary button",
    },
  },
};

const comments = [
  {
    id: "c1",
    message: "Use the compact card treatment here",
    created_at: "2026-03-19T10:00:00Z",
    client_meta: {
      node_id: "12:345",
      node_offset: { x: 4, y: 8 },
    },
    user: {
      handle: "designer",
    },
  },
];

test("buildBrief assembles normalized design context", () => {
  const brief = buildBrief({
    target,
    node,
    rawNodePayload,
    comments,
    devResources: [
      { id: "dev1", name: "Storybook", url: "https://example.test/storybook" },
    ],
    imageFillMap: {},
    screenshotPath: ".artifacts/figma-brief/checkout-summary/screenshot.png",
    rawDesignContext: { code: '<Button variant="primary">Pay now</Button>' },
    rawVariables: [{ name: "color/primary", value: "#000000" }],
    rawCodeConnect: {
      "12:347": {
        codeConnectName: "Button",
        codeConnectSrc: "src/components/ui/Button.tsx",
        snippet: '<Button variant="primary">Pay now</Button>',
      },
    },
    rawMetadata: null,
    strictTags: false,
    maxComments: 20,
  });

  assert.equal(brief.target.nodeName, "Checkout Summary");
  assert.equal(brief.intent.taggedTextNodes.length, 1);
  assert.equal(brief.intent.relevantComments.length, 1);
  assert.equal(brief.codegrounding.codeConnectComponents.length, 1);
  assert.ok(brief.confidence.overall > 0.7);

  const prompt = buildPrompt(brief);
  assert.match(prompt, /Code Connect mappings and snippets/);
  assert.match(prompt, /Preserve focus ring/);
});

test("buildBrief includes overviewNotes when provided", () => {
  const overviewNotes = [
    {
      kind: "overview",
      text: "Design exploration for a warning system",
      nodeId: "o:1",
      nodeName: "overview",
      sourceFrame: "overview content",
      confidence: 0.85,
    },
    {
      kind: "flow-step",
      text: "user uploads logo",
      nodeId: "o:2",
      nodeName: "user uploads logo",
      sourceFrame: "task flow",
      confidence: 0.8,
    },
  ];

  const brief = buildBrief({
    target,
    node,
    rawNodePayload: null,
    comments: [],
    devResources: [],
    imageFillMap: {},
    screenshotPath: null,
    rawDesignContext: null,
    rawVariables: null,
    rawCodeConnect: null,
    rawMetadata: null,
    overviewNotes,
  });

  assert.equal(brief.intent.overviewNotes.length, 2);
  assert.equal(brief.intent.overviewNotes[0].kind, "overview");
  assert.equal(brief.intent.overviewNotes[1].kind, "flow-step");
});

test("buildBrief includes flowNotes in behavior section", () => {
  const flowNotes = [
    {
      from: { nodeId: "1:1", name: "Upload" },
      to: { nodeId: "1:2", name: "Analyze" },
      label: "on submit",
    },
  ];

  const brief = buildBrief({
    target,
    node,
    rawNodePayload: null,
    comments: [],
    devResources: [],
    imageFillMap: {},
    screenshotPath: null,
    rawDesignContext: null,
    rawVariables: null,
    rawCodeConnect: null,
    rawMetadata: null,
    flowNotes,
  });

  assert.equal(brief.behavior.flowNotes.length, 1);
  assert.equal(brief.behavior.flowNotes[0].label, "on submit");
});

test("buildBrief matches instances against component manifest", () => {
  const manifest = {
    components: [
      {
        name: "button",
        path: "button/index.vue",
        aliases: ["Button", "ButtonComponent"],
        props: ["variant"],
      },
    ],
  };

  const brief = buildBrief({
    target,
    node,
    rawNodePayload: null,
    comments: [],
    devResources: [],
    imageFillMap: {},
    screenshotPath: null,
    rawDesignContext: null,
    rawVariables: null,
    rawCodeConnect: null,
    rawMetadata: null,
    componentManifest: manifest,
  });

  assert.ok(brief.codegrounding.manifestMatches.length > 0);
  assert.equal(brief.codegrounding.manifestMatches[0].match.name, "button");
});

test("buildBrief deduplicates taggedTextNodes and inferredNotes", () => {
  const nodeWithDuplicates = {
    id: "1:1",
    type: "FRAME",
    name: "Frame",
    children: [
      {
        id: "2:1",
        type: "TEXT",
        name: "note1",
        characters: "STATE: Hover darkens background",
      },
      {
        id: "2:2",
        type: "TEXT",
        name: "note2",
        characters: "STATE: Hover darkens background",
      },
      {
        id: "2:3",
        type: "TEXT",
        name: "spec note",
        characters: "Use the compact card treatment from the mobile variant.",
      },
      {
        id: "2:4",
        type: "TEXT",
        name: "spec note copy",
        characters: "Use the compact card treatment from the mobile variant.",
      },
    ],
  };

  const brief = buildBrief({
    target,
    node: nodeWithDuplicates,
    rawNodePayload: null,
    comments: [],
    devResources: [],
    imageFillMap: {},
    screenshotPath: null,
    rawDesignContext: null,
    rawVariables: null,
    rawCodeConnect: null,
    rawMetadata: null,
  });

  assert.equal(
    brief.intent.taggedTextNodes.length,
    1,
    "duplicate tagged text should be deduplicated",
  );
  assert.equal(
    brief.intent.inferredNotes.length,
    1,
    "duplicate inferred notes should be deduplicated",
  );
});
