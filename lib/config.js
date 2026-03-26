import { readFileSync } from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";

function parseOptionalBoolean(value) {
  if (value === undefined) {
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Expected true or false, received: ${value}`);
}

function parseNonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received: ${value}`);
  }

  return parsed;
}

function parseViewport(value) {
  const match = value.match(/^(\d+)x(\d+)$/);

  if (!match) {
    throw new Error(
      `Expected viewport as WxH (e.g. 1280x720), received: ${value}`,
    );
  }

  return { width: Number(match[1]), height: Number(match[2]) };
}

export function buildCliProgram({ cwd, env }) {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  const program = new Command()
    .name("figma-brief")
    .description(
      "Compile Figma-native context into an agent-friendly implementation brief.",
    )
    .version(pkg.version)
    .option("--verbose", "Print detailed progress information", false);

  program
    .command("brief", { isDefault: true })
    .description("Generate an implementation brief from a Figma node URL.")
    .argument("<figma-url>", "Figma node URL with a node-id query parameter")
    .addOption(
      new Option("--format <format>", "Output mode for emitted artifacts")
        .choices(["json", "markdown", "both"])
        .default("both"),
    )
    .option(
      "--out-dir <path>",
      "Artifact output directory",
      path.join(cwd, ".artifacts", "figma-brief"),
    )
    .option(
      "--max-comments <number>",
      "Maximum relevant comments to keep",
      parseNonNegativeInt,
      20,
    )
    .option(
      "--include-metadata [enabled]",
      "Include metadata fixture when available",
      parseOptionalBoolean,
      false,
    )
    .option(
      "--include-variables [enabled]",
      "Include MCP variable fixtures when available",
      parseOptionalBoolean,
      true,
    )
    .option(
      "--include-code-connect [enabled]",
      "Include MCP Code Connect fixtures when available",
      parseOptionalBoolean,
      true,
    )
    .option(
      "--strict-tags [enabled]",
      "Only keep tagged text notes such as STATE: and A11Y:",
      parseOptionalBoolean,
      false,
    )
    .option(
      "--mcp-url <url>",
      "Figma MCP server URL",
      env.FIGMA_MCP_URL ?? "http://localhost:3845/mcp",
    )
    .option(
      "--component-manifest <path>",
      "Path to component manifest JSON for codebase matching",
    )
    .option(
      "--feature <name-or-index>",
      "Select a specific feature when the design contains multiple",
    )
    .showHelpAfterError("(add --help for additional usage details)");

  program
    .command("compare")
    .description(
      "Compare an implementation screenshot against the Figma brief.",
    )
    .requiredOption(
      "--brief-dir <path>",
      "Path to a brief output directory containing brief.json and screenshot.png",
    )
    .requiredOption("--url <url>", "Local URL to screenshot for comparison")
    .option("--viewport <size>", "Viewport size as WxH", "1280x720")
    .option(
      "--model <model>",
      "Model for visual verification",
      env.FIGMA_BRIEF_MODEL ?? "claude-sonnet-4-6",
    )
    .option(
      "--wait <ms>",
      "Milliseconds to wait after page load before screenshot",
      parseNonNegativeInt,
      2000,
    )
    .showHelpAfterError("(add --help for additional usage details)");

  program
    .command("score")
    .description("Display a quality score report for an existing brief.")
    .requiredOption(
      "--brief-dir <path>",
      "Path to a brief output directory containing brief.json",
    )
    .option(
      "--compare-to <path>",
      "Path to a previous brief.json for score diffing",
    )
    .showHelpAfterError("(add --help for additional usage details)");

  return program;
}

export function normalizeBriefConfig({ cwd, figmaUrl, options }) {
  return {
    figmaUrl,
    format: options.format,
    outDir: path.resolve(cwd, options.outDir),
    maxComments: options.maxComments,
    includeMetadata: options.includeMetadata,
    includeVariables: options.includeVariables,
    includeCodeConnect: options.includeCodeConnect,
    strictTags: options.strictTags,
    mcpUrl: options.mcpUrl,
    componentManifestPath: options.componentManifest
      ? path.resolve(cwd, options.componentManifest)
      : null,
    featureSelector: options.feature ?? null,
  };
}

export function normalizeCompareConfig({ cwd, env, options }) {
  const viewport =
    typeof options.viewport === "string"
      ? parseViewport(options.viewport)
      : options.viewport;

  return {
    briefDir: path.resolve(cwd, options.briefDir),
    url: options.url,
    viewport,
    model: options.model,
    waitMs: options.wait,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
  };
}

export function normalizeScoreConfig({ cwd, options }) {
  return {
    briefDir: path.resolve(cwd, options.briefDir),
    compareTo: options.compareTo ? path.resolve(cwd, options.compareTo) : null,
  };
}
