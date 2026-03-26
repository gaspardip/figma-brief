import { scoreCommentText } from "./comment-relevance.js";
import { HEURISTICS } from "./heuristics.js";
import { deduplicateTexts } from "./text-utils.js";

function scoreActionability(brief) {
  const h = HEURISTICS.actionability;
  const items = [];

  for (const tag of brief.intent?.taggedTextNodes ?? []) {
    items.push(scoreCommentText(tag.text));
  }

  for (const comment of brief.intent?.relevantComments ?? []) {
    items.push(scoreCommentText(comment.text));
  }

  // Deduplicate inferred notes before scoring — repeated text inflates the metric
  const uniqueNotes = deduplicateTexts(brief.intent?.inferredNotes ?? []);

  for (const note of uniqueNotes) {
    items.push(scoreCommentText(note.text) * h.inferredNoteDiscount);
  }

  if (items.length === 0) {
    return 0;
  }

  const sum = items.reduce((a, b) => a + b, 0);
  return Math.min(1, sum / items.length / h.normalizationDivisor);
}

function scoreGrounding(brief) {
  const h = HEURISTICS.grounding;
  let score = 0;

  if ((brief.codegrounding?.codeConnectComponents ?? []).length > 0) {
    score += h.codeConnectWeight;
  }

  if ((brief.codegrounding?.devResources ?? []).length > 0) {
    score += h.devResourcesWeight;
  }

  if ((brief.codegrounding?.manifestMatches ?? []).length > 0) {
    score += h.manifestMatchesWeight;
  } else if ((brief.codegrounding?.repoHints ?? []).length > 0) {
    score += h.repoHintsWeight;
  }

  return Math.min(1, score);
}

function scoreSourceDiversity(brief) {
  let present = 0;
  const sources = [
    (brief.intent?.taggedTextNodes ?? []).length > 0,
    (brief.intent?.relevantComments ?? []).length > 0,
    (brief.intent?.inferredNotes ?? []).length > 0,
    (brief.intent?.overviewNotes ?? []).length > 0,
    (brief.codegrounding?.codeConnectComponents ?? []).length > 0,
    (brief.visual?.designContextSummary ?? []).length > 0,
    (brief.structure?.variables ?? []).length > 0,
    (brief.codegrounding?.devResources ?? []).length > 0,
    (brief.behavior?.flowNotes ?? []).length > 0,
  ];

  for (const has of sources) {
    if (has) {
      present++;
    }
  }

  return present / sources.length;
}

function scoreUniqueIntent(brief) {
  const allIntent = [
    ...(brief.intent?.taggedTextNodes ?? []),
    ...(brief.intent?.relevantComments ?? []),
    ...(brief.intent?.inferredNotes ?? []),
    ...(brief.intent?.overviewNotes ?? []),
  ];

  const unique = deduplicateTexts(allIntent);
  const totalDescendants = brief.totalDescendants ?? 1;

  // Unique intent items per 100 descendants, capped at 1
  return Math.min(1, unique.length / Math.max(1, totalDescendants / 100));
}

export function computeQualityScore(brief) {
  const w = HEURISTICS.qualityWeights;
  const totalDescendants = brief.totalDescendants ?? 1;
  const layoutCount = (brief.visual?.layoutSummary ?? []).length;

  const layoutCoverage = Math.min(
    1,
    layoutCount / Math.max(1, totalDescendants),
  );
  const actionability = scoreActionability(brief);
  const grounding = scoreGrounding(brief);
  const sourceDiversity = scoreSourceDiversity(brief);
  const uniqueIntent = scoreUniqueIntent(brief);

  const overall = Number(
    (
      layoutCoverage * w.layoutCoverage +
      actionability * w.actionability +
      uniqueIntent * w.uniqueIntent +
      grounding * w.grounding +
      sourceDiversity * w.sourceDiversity
    ).toFixed(3),
  );

  return {
    layoutCoverage: Number(layoutCoverage.toFixed(3)),
    actionability: Number(actionability.toFixed(3)),
    grounding: Number(grounding.toFixed(3)),
    sourceDiversity: Number(sourceDiversity.toFixed(3)),
    uniqueIntent: Number(uniqueIntent.toFixed(3)),
    overall,
  };
}
