export function parseMetadataXml(xml) {
  if (!xml || typeof xml !== "string") {
    return null;
  }

  const nodeStack = [];
  let root = null;

  const tagRegex = /<(\/?)(\w[\w-]*)\s*([^>]*?)(\/?)>/g;

  for (const match of xml.matchAll(tagRegex)) {
    const [, isClose, tagName, attrs, selfClose] = match;

    if (isClose) {
      nodeStack.pop();
      continue;
    }

    const normalizedType = tagName.toUpperCase().replace(/-/g, "_");
    const node = { type: normalizedType, children: [] };

    for (const [, key, value] of attrs.matchAll(/(\w+)="([^"]*)"/g)) {
      if (key === "id") {
        node.id = value;
      } else if (key === "name") {
        node.name = value;
      } else if (
        key === "x" ||
        key === "y" ||
        key === "width" ||
        key === "height"
      ) {
        if (!node.absoluteBoundingBox) {
          node.absoluteBoundingBox = {};
        }

        node.absoluteBoundingBox[key] = Number(value);
      } else if (key === "layoutMode") {
        node.layoutMode = value;
      } else if (key === "cornerRadius" || key === "opacity") {
        node[key] = Number(value);
      }
    }

    // In MCP XML metadata, TEXT node text content is carried in the name attribute
    if (node.type === "TEXT" && node.name) {
      node.characters = node.name;
    }

    const parent = nodeStack[nodeStack.length - 1];

    if (parent) {
      parent.children.push(node);
    } else {
      root = node;
    }

    if (!selfClose) {
      nodeStack.push(node);
    }
  }

  if (nodeStack.length > 0) {
    process.stderr.write(
      `Warning: parseMetadataXml finished with ${nodeStack.length} unclosed node(s)\n`,
    );
  }

  return root;
}
