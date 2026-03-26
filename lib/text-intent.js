import { HEURISTICS } from "./heuristics.js";
import { walkNodeTree } from "./tree.js";

function looksLikeFreeformInstruction(text, nodeName) {
  const lower = text.toLowerCase();
  const nameLower = String(nodeName ?? "").toLowerCase();
  const h = HEURISTICS.textIntent;

  if (h.freeformNodeNames.some((n) => nameLower.includes(n))) {
    return true;
  }

  if (h.freeformKeywords.some((needle) => lower.includes(needle))) {
    return true;
  }

  if (lower.length > h.freeformLengthThreshold) {
    return true;
  }

  return false;
}

export function extractIntentFromTextNodes(rootNode, options = {}) {
  const strictTags = options.strictTags ?? false;
  const taggedTextNodes = [];
  const inferredNotes = [];
  const h = HEURISTICS.textIntent;

  walkNodeTree(rootNode, (node) => {
    let text;

    if (node.type === "TEXT" && typeof node.characters === "string") {
      text = node.characters.trim();
    } else if (
      node.type === "INSTANCE" &&
      node.name &&
      node.children?.length === 0
    ) {
      const nameLower = node.name.toLowerCase();

      if (
        h.freeformNodeNames.some((n) => nameLower.includes(n)) ||
        looksLikeFreeformInstruction(node.name, node.name)
      ) {
        text = node.name.trim();
      }
    }

    if (!text) {
      return;
    }

    const tagMatch = text.match(/^([A-Z0-9_]+):\s*(.+)$/s);

    if (tagMatch && h.tagPrefixes.includes(tagMatch[1])) {
      taggedTextNodes.push({
        kind: tagMatch[1],
        text: tagMatch[2].trim(),
        rawText: text,
        nodeId: node.id,
        nodeName: node.name ?? "",
        confidence: h.taggedConfidence,
      });
      return;
    }

    if (strictTags) {
      return;
    }

    if (looksLikeFreeformInstruction(text, node.name)) {
      inferredNotes.push({
        kind: "freeform-text",
        text,
        rawText: text,
        nodeId: node.id,
        nodeName: node.name ?? "",
        confidence: h.inferredConfidence,
      });
    }
  });

  return {
    taggedTextNodes,
    inferredTextNotes: inferredNotes,
  };
}
