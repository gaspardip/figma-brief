export function walkNodeTree(node, visit, parent = null) {
  if (!node || typeof node !== "object") {
    return;
  }

  // Return false from visit to stop the entire walk
  if (visit(node, parent) === false) {
    return false;
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (walkNodeTree(child, visit, node) === false) {
        return false;
      }
    }
  }
}

export function collectDescendantNodeIds(rootNode) {
  const ids = new Set();

  walkNodeTree(rootNode, (node) => {
    if (node.id) {
      ids.add(node.id);
    }
  });

  return ids;
}

export function getNodeBounds(node) {
  const bounds =
    node?.absoluteBoundingBox ?? node?.absoluteRenderBounds ?? null;

  if (!bounds || typeof bounds.x !== "number" || typeof bounds.y !== "number") {
    return null;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width ?? 0,
    height: bounds.height ?? 0,
  };
}
