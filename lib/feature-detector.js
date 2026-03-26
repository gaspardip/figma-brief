import { walkNodeTree } from "./tree.js";

const FRAME_TYPES = new Set(["FRAME", "COMPONENT_SET", "COMPONENT", "SECTION"]);

function extractConnectorLabel(connector) {
  const labels = [];

  walkNodeTree(connector, (node) => {
    if (
      node.type === "TEXT" &&
      typeof node.characters === "string" &&
      node.characters.trim()
    ) {
      labels.push(node.characters.trim());
    }
  });

  return labels.join(" ").trim() || null;
}

function resolveEndpointNodeId(endpoint) {
  if (!endpoint || typeof endpoint !== "object") {
    return null;
  }

  return endpoint.endpointNodeId ?? endpoint.nodeId ?? null;
}

function findFrameForNode(nodeId, frames) {
  for (const frame of frames) {
    if (frame.nodeId === nodeId) {
      return frame;
    }
  }

  return null;
}

function findNearestFrame(point, frames, threshold = 40) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    return null;
  }

  let nearest = null;
  let minDist = threshold;

  for (const frame of frames) {
    if (!frame.bounds) {
      continue;
    }

    const { x, y, width, height } = frame.bounds;
    const edges = [
      { x: x, y: y + height / 2 },
      { x: x + width, y: y + height / 2 },
      { x: x + width / 2, y: y },
      { x: x + width / 2, y: y + height },
    ];

    for (const edge of edges) {
      const dist = Math.sqrt((point.x - edge.x) ** 2 + (point.y - edge.y) ** 2);

      if (dist < minDist) {
        minDist = dist;
        nearest = frame;
      }
    }
  }

  return nearest;
}

export function extractFlowNotes(pageNode, frames) {
  const flows = [];

  walkNodeTree(pageNode, (node) => {
    if (node.type !== "CONNECTOR") {
      return;
    }

    const fromId = resolveEndpointNodeId(node.connectorStart);
    const toId = resolveEndpointNodeId(node.connectorEnd);
    const label = extractConnectorLabel(node);

    let fromFrame = fromId ? findFrameForNode(fromId, frames) : null;
    let toFrame = toId ? findFrameForNode(toId, frames) : null;

    // Fallback: use connector position to find nearest frames
    if (!fromFrame && node.connectorStart) {
      const pos = node.connectorStart.position ?? node.absoluteBoundingBox;
      fromFrame = findNearestFrame(pos, frames);
    }

    if (!toFrame && node.connectorEnd) {
      const pos = node.connectorEnd.position ?? null;
      toFrame = findNearestFrame(pos, frames);
    }

    if (fromFrame && toFrame && fromFrame.nodeId !== toFrame.nodeId) {
      flows.push({
        from: { nodeId: fromFrame.nodeId, name: fromFrame.name },
        to: { nodeId: toFrame.nodeId, name: toFrame.name },
        label,
      });
    }
  });

  return flows;
}

export function detectFeatures(pageNode) {
  if (!pageNode || !Array.isArray(pageNode.children)) {
    return { features: [], flows: [], isMultiFeature: false };
  }

  const features = [];

  for (const child of pageNode.children) {
    if (!FRAME_TYPES.has(child.type)) {
      continue;
    }

    const bounds = child.absoluteBoundingBox ?? null;

    features.push({
      name: child.name ?? `Frame ${child.id}`,
      nodeId: child.id,
      type: child.type,
      bounds: bounds
        ? {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width ?? 0,
            height: bounds.height ?? 0,
          }
        : null,
    });
  }

  const flows = extractFlowNotes(pageNode, features);

  return {
    features,
    flows,
    isMultiFeature: features.length > 1,
  };
}

export function selectFeature(features, selector) {
  if (!selector) {
    return null;
  }

  const index = Number.parseInt(selector, 10);

  if (!Number.isNaN(index) && index >= 0 && index < features.length) {
    return features[index];
  }

  const lower = selector.toLowerCase();
  return features.find((f) => f.name.toLowerCase().includes(lower)) ?? null;
}
