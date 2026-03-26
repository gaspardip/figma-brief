import { rankRelevantComments } from "./comment-relevance.js";
import { matchComponents } from "./component-matcher.js";
import { HEURISTICS } from "./heuristics.js";
import { computeQualityScore } from "./quality-score.js";
import { extractIntentFromTextNodes } from "./text-intent.js";
import { deduplicateTexts } from "./text-utils.js";
import { collectDescendantNodeIds, walkNodeTree } from "./tree.js";

function summarizeLayout(node) {
  const maxNodes = HEURISTICS.layout.maxNodes;
  const lines = [];

  walkNodeTree(node, (current) => {
    if (lines.length >= maxNodes) {
      return false;
    }

    const summary = {
      id: current.id ?? null,
      name: current.name ?? "",
      type: current.type ?? "UNKNOWN",
    };

    if (typeof current.layoutMode === "string") {
      summary.layoutMode = current.layoutMode;
    }

    if (typeof current.primaryAxisSizingMode === "string") {
      summary.primaryAxisSizingMode = current.primaryAxisSizingMode;
    }

    if (typeof current.counterAxisSizingMode === "string") {
      summary.counterAxisSizingMode = current.counterAxisSizingMode;
    }

    if (current.absoluteBoundingBox) {
      summary.size = {
        width: current.absoluteBoundingBox.width ?? 0,
        height: current.absoluteBoundingBox.height ?? 0,
      };
    }

    lines.push(summary);
  });

  return lines;
}

function summarizeComponents(rawNodePayload) {
  return Object.entries(rawNodePayload?.components ?? {}).map(
    ([nodeId, component]) => ({
      nodeId,
      key: component?.key ?? null,
      name: component?.name ?? "",
      description: component?.description ?? "",
    }),
  );
}

function summarizeInstances(node) {
  const instances = [];

  walkNodeTree(node, (current) => {
    if (current.type === "INSTANCE") {
      instances.push({
        id: current.id ?? null,
        name: current.name ?? "",
        componentId: current.componentId ?? null,
      });
    }
  });

  return instances;
}

function collectAssetRefs(node, imageFillMap) {
  const assets = [];

  walkNodeTree(node, (current) => {
    for (const fill of current.fills ?? []) {
      if (fill?.type === "IMAGE" && fill.imageRef) {
        assets.push({
          nodeId: current.id ?? null,
          nodeName: current.name ?? "",
          imageRef: fill.imageRef,
          url: imageFillMap?.[fill.imageRef] ?? null,
        });
      }
    }
  });

  return assets;
}

function normalizeVariables(rawVariables) {
  if (!rawVariables) {
    return [];
  }

  if (Array.isArray(rawVariables)) {
    return rawVariables.map((v) => ({
      name: v?.name ?? "",
      value: v?.value ?? v?.resolvedValue ?? null,
      type: v?.resolvedType ?? v?.type ?? null,
      collection: v?.collection ?? null,
    }));
  }

  return Object.entries(rawVariables).map(([name, value]) => {
    const isObj = value !== null && typeof value === "object";

    return {
      name,
      value: isObj ? (value.value ?? value.resolvedValue ?? null) : value,
      type: isObj ? (value.resolvedType ?? value.type ?? null) : null,
      collection: isObj ? (value.collection ?? null) : null,
    };
  });
}

function normalizeCodeConnectMap(rawCodeConnect) {
  if (!rawCodeConnect) {
    return [];
  }

  if (Array.isArray(rawCodeConnect)) {
    return rawCodeConnect;
  }

  return Object.entries(rawCodeConnect).map(([nodeId, value]) => ({
    nodeId,
    codeComponent: value?.codeConnectName ?? value?.componentName ?? "",
    source: value?.codeConnectSrc ?? value?.source ?? "",
    props: value?.props ?? null,
    snippet: value?.snippet ?? null,
  }));
}

function extractTextFromCode(code) {
  const texts = new Set();

  // Extract JSX text content (between > and <)
  for (const m of code.matchAll(/>([^<]{5,})</g)) {
    const text = m[1].trim();

    if (
      text &&
      !/^[{}\s()`;/]+$/.test(text) &&
      !/className|data-node|data-name|localhost:\d+|SUPER CRITICAL|IMPORTANT:/i.test(
        text,
      )
    ) {
      texts.add(text);
    }
  }

  // Extract string literals in JSX attributes
  for (const m of code.matchAll(
    /(?:title|label|placeholder|alt|aria-label)="([^"]{3,})"/g,
  )) {
    texts.add(m[1]);
  }

  return [...texts];
}

function extractComponentsFromCode(code) {
  const components = new Set();

  for (const m of code.matchAll(/<([A-Z]\w+)/g)) {
    components.add(m[1]);
  }

  return [...components];
}

function summarizeDesignContext(rawDesignContext) {
  if (!rawDesignContext) {
    return [];
  }

  if (Array.isArray(rawDesignContext.summary)) {
    return rawDesignContext.summary;
  }

  if (
    typeof rawDesignContext.code === "string" &&
    rawDesignContext.code.trim()
  ) {
    const code = rawDesignContext.code;
    const summary = [];

    const texts = extractTextFromCode(code);

    if (texts.length > 0) {
      summary.push({ kind: "ui-text", items: texts.slice(0, 50) });
    }

    const components = extractComponentsFromCode(code);

    if (components.length > 0) {
      summary.push({ kind: "react-components", items: components });
    }

    summary.push({ kind: "code", preview: code.slice(0, 500) });

    return summary;
  }

  if (typeof rawDesignContext === "string") {
    return [
      {
        kind: "text",
        preview: rawDesignContext.slice(0, 500),
      },
    ];
  }

  return Object.keys(rawDesignContext)
    .slice(0, 8)
    .map((key) => ({
      kind: key,
      preview:
        typeof rawDesignContext[key] === "string"
          ? rawDesignContext[key].slice(0, 160)
          : "[structured]",
    }));
}

function computeStructureConfidence({ layoutSummary, components, instances }) {
  const h = HEURISTICS.confidence;
  let score = h.structureBaseline;

  if (layoutSummary.length > 0) {
    score += h.structureLayoutBonus;
  }

  if (layoutSummary.some((item) => item.layoutMode)) {
    score += h.structureLayoutModeBonus;
  }

  if (components.length > 0) {
    score += h.structureComponentsBonus;
  }

  if (instances.length > 0) {
    score += h.structureInstancesBonus;
  }

  return Math.min(h.structureCap, score);
}

function computeConfidence({
  taggedTextNodes,
  relevantComments,
  codeConnectComponents,
  designContextSummary,
  inferredTextNotes,
  layoutSummary,
  components,
  instances,
  flowNotes,
}) {
  const h = HEURISTICS.confidence;
  const visual =
    designContextSummary.length > 0
      ? h.visualWithContext
      : h.visualWithoutContext;
  const structure = computeStructureConfidence({
    layoutSummary,
    components,
    instances,
  });
  const behavior = Math.min(
    h.behaviorCap,
    h.behaviorBaseline +
      taggedTextNodes.length * h.perTaggedNode +
      relevantComments.length * h.perComment +
      inferredTextNotes.length * h.perInferredNote +
      (flowNotes?.length ?? 0) * h.perFlowNote,
  );
  const content = taggedTextNodes.some((entry) => entry.kind === "COPY")
    ? h.contentWithCopy
    : h.contentWithoutCopy;
  const overall = Number(
    (
      (visual +
        structure +
        behavior +
        content +
        (codeConnectComponents.length > 0
          ? h.codeConnectPresent
          : h.codeConnectAbsent)) /
      5
    ).toFixed(2),
  );

  return {
    overall,
    visual: Number(visual.toFixed(2)),
    structure: Number(structure.toFixed(2)),
    behavior: Number(behavior.toFixed(2)),
    content: Number(content.toFixed(2)),
  };
}

export function buildBrief({
  target,
  node,
  rawNodePayload,
  comments,
  devResources,
  imageFillMap,
  screenshotPath,
  rawDesignContext,
  rawVariables,
  rawCodeConnect,
  rawMetadata,
  strictTags = false,
  maxComments = 20,
  componentManifest = null,
  flowNotes = [],
  overviewNotes = [],
}) {
  const relevantNodeIds = collectDescendantNodeIds(node);
  const totalDescendants = relevantNodeIds.size;
  const { taggedTextNodes, inferredTextNotes } = extractIntentFromTextNodes(
    node,
    { strictTags },
  );
  const relevantComments = rankRelevantComments(
    comments,
    node,
    relevantNodeIds,
    { maxComments },
  );
  const codeConnectComponents = normalizeCodeConnectMap(rawCodeConnect);
  const designContextSummary = summarizeDesignContext(rawDesignContext);
  const layoutSummary = summarizeLayout(node);
  const components = summarizeComponents(rawNodePayload);
  const instances = summarizeInstances(node);
  const variables = normalizeVariables(rawVariables);

  const manifestMatches = componentManifest
    ? matchComponents(instances, componentManifest)
    : [];
  const matchedInstances = manifestMatches.filter((m) => m.match !== null);

  const openQuestions = [];

  if (codeConnectComponents.length === 0 && matchedInstances.length === 0) {
    openQuestions.push(
      "No Code Connect mapping or component manifest match was found. The implementation stage may need to infer component reuse.",
    );
  }

  if (taggedTextNodes.length === 0 && relevantComments.length === 0) {
    openQuestions.push(
      "No structured designer intent was found in tagged text nodes or comments.",
    );
  }

  const brief = {
    target: {
      figmaUrl: target.figmaUrl,
      fileKey: target.fileKey,
      nodeId: target.nodeId,
      nodeName: node.name ?? target.fileName,
    },
    totalDescendants,
    visual: {
      screenshotPath,
      designContextSummary,
      layoutSummary,
    },
    structure: {
      components,
      instances,
      variables,
      assets: collectAssetRefs(node, imageFillMap),
    },
    intent: {
      taggedTextNodes: deduplicateTexts(taggedTextNodes),
      relevantComments,
      inferredNotes: deduplicateTexts(inferredTextNotes),
      overviewNotes: deduplicateTexts(overviewNotes ?? []),
    },
    codegrounding: {
      codeConnectComponents,
      devResources: devResources ?? [],
      repoHints: rawMetadata?.repoHints ?? [],
      manifestMatches: matchedInstances,
    },
    behavior: {
      flowNotes: flowNotes ?? [],
    },
    openQuestions,
    confidence: computeConfidence({
      taggedTextNodes,
      relevantComments,
      codeConnectComponents,
      designContextSummary,
      inferredTextNotes,
      layoutSummary,
      components,
      instances,
      flowNotes,
    }),
  };

  brief.quality = computeQualityScore(brief);

  return brief;
}
