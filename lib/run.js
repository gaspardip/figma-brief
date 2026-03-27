import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { buildBrief } from "./brief-builder.js";
import { detectFeatures, selectFeature } from "./feature-detector.js";
import { FigmaClient } from "./figma-client.js";
import { classifyChildFrames } from "./frame-classifier.js";
import { extractOverviewNotes } from "./overview-extractor.js";
import { parseFigmaUrl } from "./parse-figma-url.js";
import { parseMetadataXml } from "./parse-metadata-xml.js";
import { buildPrompt } from "./prompt-template.js";
import { slugify } from "./slugify.js";
import { walkNodeTree } from "./tree.js";

async function writeJsonIfPresent(filePath, value) {
  if (value === null || value === undefined) {
    return;
  }

  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeArtifacts({
  outputDir,
  brief,
  prompt,
  rawArtifacts,
  format,
}) {
  await fs.mkdir(outputDir, { recursive: true });

  if (format === "json" || format === "both") {
    await fs.writeFile(
      path.join(outputDir, "brief.json"),
      `${JSON.stringify(brief, null, 2)}\n`,
      "utf8",
    );
  }

  if (format === "markdown" || format === "both") {
    await fs.writeFile(
      path.join(outputDir, "prompt.md"),
      `${prompt}\n`,
      "utf8",
    );
  }

  await writeJsonIfPresent(
    path.join(outputDir, "raw-design-context.json"),
    rawArtifacts.designContext,
  );
  await writeJsonIfPresent(
    path.join(outputDir, "raw-variables.json"),
    rawArtifacts.variables,
  );
  await writeJsonIfPresent(
    path.join(outputDir, "raw-metadata.json"),
    rawArtifacts.metadata,
  );
}

async function loadManifest(manifestPath, log) {
  if (!manifestPath) {
    return null;
  }

  log("Loading component manifest", { path: manifestPath });

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    if (!Array.isArray(manifest.components)) {
      throw new Error("Manifest must have a 'components' array");
    }

    log("Component manifest loaded", {
      components: manifest.components.length,
    });
    return manifest;
  } catch (error) {
    throw new Error(
      `Failed to load component manifest from ${manifestPath}: ${error.message}`,
    );
  }
}

async function promptFeatureSelection(features, flows) {
  console.log("\nMultiple features detected:\n");

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const flowInfo = flows.some(
      (fl) => fl.from.nodeId === f.nodeId || fl.to.nodeId === f.nodeId,
    )
      ? " (in flow)"
      : "";
    console.log(`  ${i}. ${f.name}${flowInfo}`);
  }

  if (flows.length > 0) {
    console.log("\nFlow transitions:");

    for (const fl of flows) {
      console.log(
        `  ${fl.from.name} → ${fl.to.name}${fl.label ? `: ${fl.label}` : ""}`,
      );
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      "\nSelect feature (number, name, or 'all'): ",
    );
    return answer.trim();
  } finally {
    rl.close();
  }
}

export function findInstanceIds(node, namePattern) {
  const ids = [];

  walkNodeTree(node, (n) => {
    if (
      n.type === "INSTANCE" &&
      n.name &&
      namePattern.test(n.name.toLowerCase()) &&
      n.children?.length === 0
    ) {
      ids.push(n.id);
    }
  });

  return ids;
}

async function expandInstances(figma, node, log) {
  // Find annotation/callout instances whose internals aren't in the XML
  const pattern = /annotation|callout|note|button/;
  const instanceIds = findInstanceIds(node, pattern);

  if (instanceIds.length === 0) {
    return;
  }

  log("Expanding instance internals", { count: instanceIds.length });

  // Fetch metadata for each instance to get their children (text content)
  const results = await Promise.all(
    instanceIds.map((id) => figma.getMetadata(id).catch(() => null)),
  );

  const failCount = results.filter((r) => r === null).length;

  if (failCount > 0) {
    log("Instance expansion failures", {
      failed: failCount,
      total: instanceIds.length,
    });
  }

  for (let i = 0; i < instanceIds.length; i++) {
    const xml = results[i];

    if (!xml) {
      continue;
    }

    const expanded = parseMetadataXml(xml);

    if (!expanded?.children?.length) {
      continue;
    }

    // Find the original instance in the tree and add the expanded children
    walkNodeTree(node, (n) => {
      if (n.id === instanceIds[i]) {
        n.children = expanded.children;

        // Also set characters on any TEXT children
        for (const child of n.children) {
          if (child.type === "TEXT" && child.name) {
            child.characters = child.name;
          }
        }

        return false; // stop walking
      }
    });
  }
}

async function gatherNodeContext(figma, nodeId, config, log) {
  log("Fetching design context and metadata via MCP", { nodeId });

  const [designContext, metadata, variables] = await Promise.all([
    figma.getDesignContext(nodeId).catch((e) => {
      log("Design context fetch failed (non-fatal)", { error: e.message });
      return null;
    }),
    figma.getMetadata(nodeId).catch((e) => {
      log("Metadata fetch failed (non-fatal)", { error: e.message });
      return null;
    }),
    config.includeVariables
      ? figma.getVariableDefs(nodeId).catch((e) => {
          log("Variables fetch failed (non-fatal)", { error: e.message });
          return null;
        })
      : null,
  ]);

  log("MCP data gathered", {
    hasDesignContext: designContext !== null,
    hasMetadata: metadata !== null,
    hasVariables: variables !== null,
  });

  return { designContext, metadata, variables };
}

async function processFeature({
  target,
  featureNode,
  figma,
  config,
  componentManifest,
  flowNotes,
  pageNode,
  log,
}) {
  const nodeId = featureNode.nodeId ?? featureNode.id;
  const nodeName = featureNode.name ?? target.fileName;
  const featureTarget = { ...target, nodeId };

  const { designContext, metadata, variables } = await gatherNodeContext(
    figma,
    nodeId,
    config,
    log,
  );
  const targetNode = parseMetadataXml(metadata) ?? featureNode;

  // Expand annotation instances to get their interior text
  if (figma) {
    await expandInstances(figma, targetNode, log);
  }

  const outputDir = path.join(config.outDir, slugify(nodeName));
  const screenshotPath = path.join(outputDir, "screenshot.png");
  const savedScreenshotPath = await figma.getScreenshotWithFallback(
    nodeId,
    screenshotPath,
  );

  if (savedScreenshotPath) {
    log("Screenshot saved", { path: savedScreenshotPath });
  }

  // Per-frame screenshots: classify children and screenshot each screen
  let frameScreenshots = null;
  const { screens } = classifyChildFrames(targetNode);

  if (screens.length > 0 && figma) {
    frameScreenshots = {};
    log("Screenshotting individual frames", { count: screens.length });

    for (const screen of screens) {
      const framePath = path.join(
        outputDir,
        `frame-${screen.nodeId.replace(":", "-")}.png`,
      );
      const saved = await figma
        .getScreenshotWithFallback(screen.nodeId, framePath)
        .catch(() => null);

      if (saved) {
        frameScreenshots[screen.nodeId] = {
          name: screen.name,
          path: framePath,
          width: screen.width,
          height: screen.height,
        };
      }
    }
  }

  // Extract overview/context notes from page-level sibling frames
  const overviewNotes = pageNode ? extractOverviewNotes(pageNode) : [];

  const brief = buildBrief({
    target: featureTarget,
    node: targetNode,
    rawNodePayload: null,
    comments: [],
    devResources: [],
    imageFillMap: {},
    screenshotPath: savedScreenshotPath,
    rawDesignContext: designContext ? { code: designContext } : null,
    rawVariables: variables,
    rawCodeConnect: null,
    rawMetadata: null,
    strictTags: config.strictTags,
    maxComments: config.maxComments,
    componentManifest,
    flowNotes,
    frameScreenshots,
    overviewNotes,
  });

  const prompt = buildPrompt(brief);

  log("Brief built", {
    feature: nodeName,
    confidence: brief.confidence.overall,
    quality: brief.quality.overall,
  });

  await writeArtifacts({
    outputDir,
    brief,
    prompt,
    format: config.format,
    rawArtifacts: { designContext, variables, metadata },
  });

  return { outputDir, brief, prompt };
}

export async function generateFigmaBrief(config, { log = () => {} } = {}) {
  const target = parseFigmaUrl(config.figmaUrl);
  log("Parsed Figma URL", {
    fileKey: target.fileKey,
    nodeId: target.nodeId,
    isPageLevel: target.isPageLevel,
  });

  const figma = new FigmaClient({
    mcpUrl: config.mcpUrl,
    log,
    fileKey: target.fileKey,
    figmaAccessToken: config.figmaAccessToken,
  });
  const componentManifest = await loadManifest(
    config.componentManifestPath,
    log,
  );

  try {
    await figma.connect();

    const pageMetadataXml = await figma.getMetadata(target.nodeId);
    const pageNode = parseMetadataXml(pageMetadataXml);

    if (!pageNode) {
      throw new Error(
        "Unable to get design structure from Figma MCP. Is the file open in the Figma desktop app?",
      );
    }

    log("Page node resolved", {
      name: pageNode.name,
      type: pageNode.type,
      children: pageNode.children?.length ?? 0,
    });

    if (target.isPageLevel) {
      const detection = detectFeatures(pageNode);

      if (detection.isMultiFeature) {
        log("Multiple features detected", {
          count: detection.features.length,
          flows: detection.flows.length,
        });

        let selectedFeatures;

        if (config.featureSelector) {
          if (config.featureSelector === "all") {
            selectedFeatures = detection.features;
          } else {
            const selected = selectFeature(
              detection.features,
              config.featureSelector,
            );

            if (!selected) {
              const names = detection.features.map((f) => f.name).join(", ");
              throw new Error(
                `Feature "${config.featureSelector}" not found. Available: ${names}`,
              );
            }

            selectedFeatures = [selected];
          }
        } else {
          const answer = await promptFeatureSelection(
            detection.features,
            detection.flows,
          );

          if (answer === "all") {
            selectedFeatures = detection.features;
          } else {
            const selected = selectFeature(detection.features, answer);

            if (!selected) {
              throw new Error(`Could not match "${answer}" to a feature.`);
            }

            selectedFeatures = [selected];
          }
        }

        const results = [];

        for (const feature of selectedFeatures) {
          const featureNode =
            pageNode.children?.find((c) => c.id === feature.nodeId) ?? feature;

          const result = await processFeature({
            target,
            featureNode,
            figma,
            config,
            componentManifest,
            flowNotes: detection.flows,
            pageNode,
            log,
          });

          results.push(result);
        }

        if (results.length === 1) {
          return results[0];
        }

        for (const r of results) {
          console.log(`  Feature brief: ${r.outputDir}`);
        }

        return results[results.length - 1];
      }
    }

    return await processFeature({
      target,
      featureNode: pageNode,
      figma,
      config,
      componentManifest,
      flowNotes: [],
      pageNode,
      log,
    });
  } finally {
    await figma.close();
  }
}
