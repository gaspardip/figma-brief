import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function extractTextContent(result) {
  if (!result?.content || !Array.isArray(result.content)) {
    return null;
  }

  const textParts = result.content.filter((c) => c.type === "text");
  return textParts.length > 0 ? textParts.map((c) => c.text).join("\n") : null;
}

function extractImageContent(result) {
  if (!result?.content || !Array.isArray(result.content)) {
    return null;
  }

  const imagePart = result.content.find((c) => c.type === "image");
  return imagePart
    ? { data: imagePart.data, mimeType: imagePart.mimeType ?? "image/png" }
    : null;
}

export class FigmaClient {
  constructor({ mcpUrl = "http://localhost:3845/mcp", log = () => {} }) {
    this.mcpUrl = mcpUrl;
    this.log = log;
    this.client = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) {
      return;
    }

    this.log("Connecting to Figma MCP", { url: this.mcpUrl });

    this.client = new Client({ name: "figma-brief", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl));

    try {
      await this.client.connect(transport);
      this.connected = true;
      this.log("Figma MCP connected");
    } catch (error) {
      throw new Error(
        `Failed to connect to Figma MCP at ${this.mcpUrl}: ${error.message}`,
      );
    }
  }

  async close() {
    if (this.client && this.connected) {
      try {
        await this.client.close();
      } catch {
        // ignore close errors
      }

      this.connected = false;
    }
  }

  async callTool(name, args = {}) {
    if (!this.connected) {
      await this.connect();
    }

    this.log(`MCP tool call: ${name}`, args);

    const result = await this.client.callTool({ name, arguments: args });

    if (result.isError) {
      const errorText = extractTextContent(result) ?? "Unknown MCP error";
      throw new Error(`Figma MCP tool "${name}" failed: ${errorText}`);
    }

    return result;
  }

  async getMetadata(
    nodeId,
    { clientFrameworks = "vue", clientLanguages = "typescript", fileKey } = {},
  ) {
    const args = { nodeId: nodeId ?? "", clientFrameworks, clientLanguages };
    if (fileKey) args.fileKey = fileKey;
    const result = await this.callTool("get_metadata", args);

    return extractTextContent(result);
  }

  async getDesignContext(
    nodeId,
    { clientFrameworks = "vue", clientLanguages = "typescript", fileKey } = {},
  ) {
    const args = {
      nodeId: nodeId ?? "",
      clientFrameworks,
      clientLanguages,
      artifactType: "COMPONENT_WITHIN_A_WEB_PAGE_OR_APP_SCREEN",
      forceCode: true,
    };
    if (fileKey) args.fileKey = fileKey;
    const result = await this.callTool("get_design_context", args);

    return extractTextContent(result);
  }

  async getVariableDefs(
    nodeId,
    { clientFrameworks = "vue", clientLanguages = "typescript", fileKey } = {},
  ) {
    const args = { nodeId: nodeId ?? "", clientFrameworks, clientLanguages };
    if (fileKey) args.fileKey = fileKey;
    const result = await this.callTool("get_variable_defs", args);

    return extractTextContent(result);
  }

  async getScreenshot(
    nodeId,
    outputPath,
    { clientFrameworks = "vue", clientLanguages = "typescript", fileKey } = {},
  ) {
    const args = { nodeId: nodeId ?? "", clientFrameworks, clientLanguages };
    if (fileKey) args.fileKey = fileKey;
    const result = await this.callTool("get_screenshot", args);

    const image = extractImageContent(result);

    if (!image) {
      // Screenshot might be returned as a localhost URL in text content
      const text = extractTextContent(result);

      if (text) {
        const urlMatch = text.match(/http:\/\/localhost:\d+\/assets\/[^\s"']+/);

        if (urlMatch) {
          return this.downloadUrl(urlMatch[0], outputPath);
        }
      }

      return null;
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(image.data, "base64"));
    return outputPath;
  }

  async downloadUrl(url, outputPath) {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, bytes);
    return outputPath;
  }
}
