import { HEURISTICS } from "./heuristics.js";
import { getNodeBounds } from "./tree.js";

function getCommentText(comment) {
  return String(
    comment?.message ?? comment?.text ?? comment?.comment ?? "",
  ).trim();
}

function getCommentPoint(clientMeta) {
  if (!clientMeta || typeof clientMeta !== "object") {
    return null;
  }

  if (typeof clientMeta.x === "number" && typeof clientMeta.y === "number") {
    return { x: clientMeta.x, y: clientMeta.y };
  }

  if (
    clientMeta.node_offset &&
    typeof clientMeta.node_offset.x === "number" &&
    typeof clientMeta.node_offset.y === "number"
  ) {
    return {
      x: clientMeta.node_offset.x,
      y: clientMeta.node_offset.y,
    };
  }

  return null;
}

export function scoreCommentText(text) {
  if (!text) {
    return 0;
  }

  const h = HEURISTICS.commentRelevance;
  const lower = text.toLowerCase();
  let score = h.baselineScore;

  if (/^(state|a11y|data|copy|do|dont):/i.test(text)) {
    score += h.prefixBonus;
  }

  if (h.keywords.some((needle) => lower.includes(needle))) {
    score += h.keywordBonus;
  }

  if (text.length > h.lengthThreshold) {
    score += h.lengthBonus;
  }

  return score;
}

function scoreCommentLocation(comment, context) {
  const h = HEURISTICS.commentRelevance;
  const clientMeta = comment?.client_meta;
  const nodeId = clientMeta?.node_id;

  if (nodeId && context.relevantNodeIds.has(nodeId)) {
    return h.nodeIdMatchScore;
  }

  const point = getCommentPoint(clientMeta);

  if (!point || !context.targetBounds) {
    return 0;
  }

  const { x, y, width, height } = context.targetBounds;
  const inside =
    point.x >= x &&
    point.x <= x + width &&
    point.y >= y &&
    point.y <= y + height;

  return inside ? h.boundsMatchScore : 0;
}

export function rankRelevantComments(
  comments,
  targetNode,
  relevantNodeIds,
  options = {},
) {
  const h = HEURISTICS.commentRelevance;
  const targetBounds = getNodeBounds(targetNode);
  const maxComments = options.maxComments ?? 20;
  const threshold = options.threshold ?? h.relevanceThreshold;

  return comments
    .map((comment) => {
      const text = getCommentText(comment);
      const score = Math.max(
        0,
        Math.min(
          0.99,
          scoreCommentText(text) +
            scoreCommentLocation(comment, { targetBounds, relevantNodeIds }) -
            (comment.resolved_at ? h.resolvedPenalty : 0),
        ),
      );

      return {
        author: comment?.user?.handle ?? comment?.user?.name ?? "unknown",
        id: comment?.id ?? null,
        text,
        createdAt: comment?.created_at ?? null,
        resolvedAt: comment?.resolved_at ?? null,
        confidence: Number(score.toFixed(2)),
        clientMeta: comment?.client_meta ?? null,
      };
    })
    .filter((comment) => comment.text && comment.confidence >= threshold)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, maxComments);
}
