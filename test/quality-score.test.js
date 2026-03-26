import assert from "node:assert/strict";
import test from "node:test";
import { computeQualityScore } from "../lib/quality-score.js";

const fullBrief = {
  totalDescendants: 10,
  visual: {
    layoutSummary: [
      { name: "Root", type: "FRAME", layoutMode: "VERTICAL" },
      { name: "Row", type: "FRAME", layoutMode: "HORIZONTAL" },
      { name: "Button", type: "INSTANCE" },
    ],
    designContextSummary: [{ kind: "code", preview: "<Button />" }],
  },
  structure: {
    instances: [{ id: "1:1", name: "Button", componentId: "c1" }],
    variables: [{ name: "color/primary", value: "#000" }],
  },
  intent: {
    taggedTextNodes: [
      {
        kind: "STATE",
        text: "Hover state darkens background",
        confidence: 0.93,
      },
    ],
    relevantComments: [
      { text: "Use the compact card treatment here", confidence: 0.7 },
    ],
    inferredNotes: [{ text: "This card should collapse on mobile viewport." }],
  },
  codegrounding: {
    codeConnectComponents: [
      { codeComponent: "Button", source: "src/Button.vue" },
    ],
    devResources: [{ name: "Storybook", url: "https://example.test" }],
    repoHints: [],
    manifestMatches: [],
  },
};

test("computeQualityScore returns all axes", () => {
  const score = computeQualityScore(fullBrief);

  assert.ok("layoutCoverage" in score);
  assert.ok("actionability" in score);
  assert.ok("grounding" in score);
  assert.ok("sourceDiversity" in score);
  assert.ok("uniqueIntent" in score);
  assert.ok("overall" in score);
});

test("computeQualityScore is deterministic", () => {
  const a = computeQualityScore(fullBrief);
  const b = computeQualityScore(fullBrief);

  assert.deepEqual(a, b);
});

test("layoutCoverage scales with layout vs descendants", () => {
  const sparse = {
    ...fullBrief,
    totalDescendants: 100,
    visual: { layoutSummary: [{ name: "R" }] },
  };
  const dense = {
    ...fullBrief,
    totalDescendants: 3,
    visual: { layoutSummary: [{ name: "A" }, { name: "B" }, { name: "C" }] },
  };

  const sparseScore = computeQualityScore(sparse);
  const denseScore = computeQualityScore(dense);

  assert.ok(denseScore.layoutCoverage > sparseScore.layoutCoverage);
});

test("grounding is higher with Code Connect", () => {
  const withCC = computeQualityScore(fullBrief);
  const withoutCC = computeQualityScore({
    ...fullBrief,
    codegrounding: {
      codeConnectComponents: [],
      devResources: [],
      repoHints: [],
      manifestMatches: [],
    },
  });

  assert.ok(withCC.grounding > withoutCC.grounding);
});

test("sourceDiversity counts distinct signal types", () => {
  const rich = computeQualityScore(fullBrief);

  const minimal = computeQualityScore({
    totalDescendants: 1,
    visual: { layoutSummary: [], designContextSummary: [] },
    structure: { variables: [] },
    intent: { taggedTextNodes: [], relevantComments: [], inferredNotes: [] },
    codegrounding: {
      codeConnectComponents: [],
      devResources: [],
      repoHints: [],
    },
  });

  assert.ok(rich.sourceDiversity > minimal.sourceDiversity);
  assert.equal(minimal.sourceDiversity, 0);
});

test("empty brief scores zero across all axes", () => {
  const score = computeQualityScore({});

  assert.equal(score.layoutCoverage, 0);
  assert.equal(score.actionability, 0);
  assert.equal(score.grounding, 0);
  assert.equal(score.sourceDiversity, 0);
  assert.equal(score.uniqueIntent, 0);
  assert.equal(score.overall, 0);
});

test("overall is a weighted average of all axes", () => {
  const score = computeQualityScore(fullBrief);
  const expected = Number(
    (
      score.layoutCoverage * 0.3 +
      score.actionability * 0.25 +
      score.uniqueIntent * 0.2 +
      score.grounding * 0.15 +
      score.sourceDiversity * 0.1
    ).toFixed(3),
  );

  assert.equal(score.overall, expected);
});
