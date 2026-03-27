const FRAME_TYPES = new Set(["FRAME", "SECTION", "COMPONENT", "COMPONENT_SET"]);

export function classifyChildFrames(sectionNode, options = {}) {
  const minScreenWidth = options.minScreenWidth ?? 800;
  const minScreenHeight = options.minScreenHeight ?? 600;

  if (!sectionNode?.children?.length) {
    return { screens: [], annotations: [], other: [] };
  }

  const screens = [];
  const annotations = [];
  const other = [];

  for (const child of sectionNode.children) {
    const bounds = child.absoluteBoundingBox;
    const width = bounds?.width ?? 0;
    const height = bounds?.height ?? 0;

    if (
      FRAME_TYPES.has(child.type) &&
      width >= minScreenWidth &&
      height >= minScreenHeight
    ) {
      screens.push({
        nodeId: child.id,
        name: child.name ?? `Frame ${child.id}`,
        width,
        height,
      });
    } else if (child.type === "INSTANCE" && width < minScreenWidth) {
      annotations.push({
        nodeId: child.id,
        name: child.name ?? "",
        width,
        height,
      });
    } else {
      other.push({
        nodeId: child.id,
        name: child.name ?? "",
        width,
        height,
        type: child.type,
      });
    }
  }

  return { screens, annotations, other };
}
