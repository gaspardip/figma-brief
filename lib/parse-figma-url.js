const SUPPORTED_FILE_TYPES = new Set(["design", "file", "board"]);

export function parseFigmaUrl(input) {
  let url;

  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid Figma URL: ${input}`);
  }

  if (!/(\.|^)figma\.com$/i.test(url.hostname)) {
    throw new Error(`Expected a Figma URL, received host: ${url.hostname}`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const [fileType, fileKey, ...rest] = segments;

  if (!SUPPORTED_FILE_TYPES.has(fileType) || !fileKey || rest.length === 0) {
    throw new Error(`Unsupported Figma URL path: ${url.pathname}`);
  }

  const rawNodeId = url.searchParams.get("node-id") ?? null;
  const nodeId = rawNodeId ? rawNodeId.replace(/-/g, ":") : null;

  return {
    editorType: fileType,
    figmaUrl: input,
    fileKey,
    fileName: rest.join("/"),
    rawNodeId,
    nodeId,
    isPageLevel: !rawNodeId || rawNodeId === "0-1",
  };
}

export function toHyphenatedNodeId(nodeId) {
  return nodeId.replace(/:/g, "-");
}
