import { walkNodeTree } from "./tree.js";

export function extractOverviewNotes(pageNode) {
  if (!pageNode || !Array.isArray(pageNode.children)) {
    return [];
  }

  const notes = [];
  const overviewNames = [
    "overview",
    "context",
    "description",
    "notes",
    "spec",
    "brief",
    "task",
    "flow",
  ];

  for (const child of pageNode.children) {
    const nameLower = (child.name ?? "").toLowerCase();
    const isOverview = overviewNames.some((n) => nameLower.includes(n));

    if (!isOverview) {
      continue;
    }

    walkNodeTree(child, (node) => {
      let text = null;

      if (node.type === "TEXT" && node.characters) {
        text = node.characters.trim();
      } else if (node.type === "SHAPE_WITH_TEXT" && node.name) {
        // Flow chart shapes carry their label in the name attribute
        text = node.name.trim();
      }

      if (text && text.length > 10) {
        const kind =
          nameLower.includes("flow") || nameLower.includes("task")
            ? "flow-step"
            : "overview";

        notes.push({
          kind,
          text,
          nodeId: node.id,
          nodeName: node.name ?? "",
          sourceFrame: child.name,
          confidence: kind === "flow-step" ? 0.8 : 0.85,
        });
      }
    });
  }

  return notes;
}
