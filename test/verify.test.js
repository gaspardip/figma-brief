import assert from "node:assert/strict";
import test from "node:test";
import { extractClaims } from "../lib/visual-verify.js";

const fullBrief = {
  target: { nodeName: "Checkout Summary" },
  visual: {
    layoutSummary: [
      {
        name: "Checkout Summary",
        type: "FRAME",
        layoutMode: "VERTICAL",
        size: { width: 320, height: 200 },
      },
      { name: "Row", type: "FRAME" },
    ],
    designContextSummary: [
      { kind: "code", preview: '<Button variant="primary" />' },
    ],
  },
  structure: {
    instances: [
      { id: "12:347", name: "Button / Primary", componentId: "1:22" },
    ],
    variables: [{ name: "color/primary", value: "#000000" }],
  },
  intent: {
    taggedTextNodes: [
      { kind: "A11Y", text: "Preserve focus ring", confidence: 0.93 },
    ],
    relevantComments: [
      { text: "Use compact card treatment", confidence: 0.7 },
      { text: "nice", confidence: 0.3 },
    ],
    inferredNotes: [
      { text: "Use the compact card treatment from the mobile variant." },
    ],
  },
  codegrounding: {
    codeConnectComponents: [
      { codeComponent: "Button", source: "src/components/ui/Button.tsx" },
    ],
  },
};

test("extractClaims generates claims from all brief sections", () => {
  const claims = extractClaims(fullBrief);

  const sources = new Set(claims.map((c) => c.source));

  assert.ok(sources.has("visual.layoutSummary"));
  assert.ok(sources.has("structure.instances"));
  assert.ok(sources.has("intent.taggedTextNodes"));
  assert.ok(sources.has("intent.relevantComments"));
  assert.ok(sources.has("intent.inferredNotes"));
  assert.ok(sources.has("codegrounding.codeConnectComponents"));
  assert.ok(sources.has("visual.designContextSummary"));
});

test("extractClaims skips layout items without layoutMode", () => {
  const claims = extractClaims(fullBrief);
  const layoutClaims = claims.filter(
    (c) => c.source === "visual.layoutSummary",
  );

  assert.equal(layoutClaims.length, 1);
  assert.match(layoutClaims[0].claim, /VERTICAL/);
});

test("extractClaims marks A11Y claims as high severity", () => {
  const claims = extractClaims(fullBrief);
  const a11y = claims.find((c) => c.source === "intent.taggedTextNodes");

  assert.equal(a11y.severity, "high");
});

test("extractClaims marks Code Connect claims as high severity", () => {
  const claims = extractClaims(fullBrief);
  const cc = claims.find(
    (c) => c.source === "codegrounding.codeConnectComponents",
  );

  assert.equal(cc.severity, "high");
});

test("extractClaims filters out low-confidence comments", () => {
  const claims = extractClaims(fullBrief);
  const commentClaims = claims.filter(
    (c) => c.source === "intent.relevantComments",
  );

  assert.equal(commentClaims.length, 1);
  assert.match(commentClaims[0].claim, /compact card/);
});

test("extractClaims returns empty array for empty brief", () => {
  const claims = extractClaims({});

  assert.deepEqual(claims, []);
});
