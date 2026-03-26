// Consolidated extraction knobs — the single mutable surface for autoresearch.
// Every tunable constant lives here. Other modules import from this file.
//
// KNOB STATUS (for autoresearch agent):
//   ACTIVE   — directly affects extraction quality for current test designs
//   DORMANT  — has no effect because the data source isn't available
//   INDIRECT — affects scoring/confidence but not what gets extracted
//
// If all ACTIVE knobs are exhausted and the score plateaus:
// 1. Write autoresearch/plateau-report.md listing what CODE CHANGES are needed
// 2. Possible expansions: extract more node attributes in parseMetadataXml (fills,
//    strokes, typography), increase XML parsing depth, add new MCP tool calls
// 3. This signals the human to expand the mutable surface
//
// ANTI-GAMING: Do not inflate scores by changing INDIRECT knobs to make bad
// extractions look good. The judge step catches this — if the brief can't
// one-shot the design, the composite stays low regardless of weight tuning.

export const HEURISTICS = {
  // ACTIVE — controls how many nodes appear in layoutSummary
  layout: {
    maxNodes: 9999,
  },

  // ACTIVE — controls freeform text detection from Figma TEXT nodes
  textIntent: {
    tagPrefixes: ["STATE", "A11Y", "DATA", "COPY", "DO", "DONT"],
    freeformNodeNames: [
      "note",
      "comment",
      "spec",
      "description",
      "annotation",
      "callout",
    ],
    freeformKeywords: [
      "should ",
      "replace ",
      "use ",
      "don't ",
      "do not ",
      "hover",
      "spacing",
      "padding",
      "margin",
      "token",
      "variant",
      "a11y",
      "accessibility",
      "on click",
      "on hover",
      "on tap",
      "when ",
      "if ",
      "must ",
      "needs to",
      "recommended",
      "warning",
      "error",
      "toggle",
      "modal",
      "tooltip",
      "disabled",
      "selected",
      "active",
      "focus",
      "detect",
      "before",
      "after",
      "compare",
      "original",
      "adjusted",
      "slider",
      "split",
      "view",
      "upload ",
      "continue",
      "tap ",
      "tapping",
    ],
    freeformLengthThreshold: 80,
    taggedConfidence: 0.93,
    inferredConfidence: 0.38,
  },

  // PARTIALLY ACTIVE — MCP does not expose Figma comments directly, but
  // scoreCommentText is reused by quality-score.js to score inferred notes
  // and tagged text. The keyword list here affects actionability scoring.
  commentRelevance: {
    baselineScore: 0.05,
    prefixBonus: 0.35,
    keywordBonus: 0.2,
    lengthBonus: 0.05,
    lengthThreshold: 20,
    nodeIdMatchScore: 0.55,
    boundsMatchScore: 0.3,
    resolvedPenalty: 0.1,
    relevanceThreshold: 0.35,
    keywords: [
      "hover",
      "spacing",
      "align",
      "variant",
      "use ",
      "replace ",
      "copy",
      "a11y",
      "accessibility",
      "click",
      "tap",
      "toggle",
      "modal",
      "warning",
      "error",
      "color",
      "font",
      "size",
      "width",
      "height",
    ],
  },

  // INDIRECT — affects confidence scoring, not what gets extracted
  confidence: {
    visualWithContext: 0.9,
    visualWithoutContext: 0.62,
    behaviorBaseline: 0.35,
    perTaggedNode: 0.18,
    perComment: 0.08,
    perInferredNote: 0.03,
    perFlowNote: 0.12,
    behaviorCap: 0.95,
    contentWithCopy: 0.9,
    contentWithoutCopy: 0.6,
    codeConnectPresent: 0.9,
    codeConnectAbsent: 0.55,
    structureBaseline: 0.4,
    structureLayoutBonus: 0.15,
    structureLayoutModeBonus: 0.15,
    structureComponentsBonus: 0.15,
    structureInstancesBonus: 0.1,
    structureCap: 0.95,
  },

  // INDIRECT — affects quality score calculation
  qualityWeights: {
    layoutCoverage: 0.3,
    actionability: 0.25,
    uniqueIntent: 0.2,
    grounding: 0.15,
    sourceDiversity: 0.1,
  },

  // INDIRECT — affects how inferred notes are scored, not what gets extracted
  actionability: {
    inferredNoteDiscount: 0.6,
    normalizationDivisor: 0.65,
  },

  // INDIRECT — affects grounding score weights, not what gets matched
  grounding: {
    codeConnectWeight: 0.5,
    devResourcesWeight: 0.25,
    manifestMatchesWeight: 0.25,
    repoHintsWeight: 0.1,
  },

  // ACTIVE — controls how Figma instances match to codebase components
  componentMatching: {
    exactConfidence: 0.95,
    aliasConfidence: 0.9,
    wordContainmentConfidence: 0.8,
    fuzzyThreshold: 0.4,
    fuzzyMultiplier: 0.7,
    blockPairs: [
      { instancePattern: "drop.?down", componentName: "drop-zone" },
      { instancePattern: "image.?selected", componentName: "select" },
    ],
  },
};
