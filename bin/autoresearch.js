#!/usr/bin/env node

// Single-iteration autoresearch harness.
// Runs the CLI against all test designs, scores the output, appends to results.tsv.
// Designed to be called repeatedly by an autonomous agent.
//
// First run: fetches live MCP data and caches it to autoresearch/cache/.
// Subsequent runs: reads from cache (frozen truth layer).
// Use --refresh to re-fetch from MCP and update the cache.

import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildBrief } from "../lib/brief-builder.js";
import { detectFeatures, selectFeature } from "../lib/feature-detector.js";
import { classifyChildFrames } from "../lib/frame-classifier.js";
import { createLogger } from "../lib/logger.js";
import { extractOverviewNotes } from "../lib/overview-extractor.js";
import { parseMetadataXml } from "../lib/parse-metadata-xml.js";
import { buildPrompt } from "../lib/prompt-template.js";
import { findInstanceIds } from "../lib/run.js";
import { slugify } from "../lib/slugify.js";
import { walkNodeTree } from "../lib/tree.js";
import { runVerification } from "../lib/verifier.js";

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const FIXTURES_PATH = path.join(
  PROJECT_ROOT,
  "autoresearch",
  "fixtures",
  "designs.json",
);
const RESULTS_PATH = path.join(PROJECT_ROOT, "autoresearch", "results.tsv");
const CACHE_DIR = path.join(PROJECT_ROOT, "autoresearch", "cache");

async function getGitHash() {
  try {
    const { stdout } = await execFile("git", ["rev-parse", "--short", "HEAD"], {
      cwd: PROJECT_ROOT,
    });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function ensureResultsHeader() {
  try {
    await fs.access(RESULTS_PATH);
  } catch {
    await fs.writeFile(
      RESULTS_PATH,
      "timestamp\tcommit\tdesign\tstructural\tllm_judge\tcomposite\tstatus\tdescription\n",
      "utf8",
    );
  }
}

async function appendResult(row) {
  const line = [
    new Date().toISOString(),
    row.commit,
    row.design,
    row.structural.toFixed(3),
    row.llmJudge.toFixed(3),
    row.composite.toFixed(3),
    row.status,
    row.description,
  ].join("\t");

  await fs.appendFile(RESULTS_PATH, line + "\n", "utf8");
}

async function getIncumbent() {
  try {
    const content = await fs.readFile(RESULTS_PATH, "utf8");
    const lines = content.trim().split("\n").slice(1);

    // Group rows by commit (same commit = same run) and average composites per run
    const runs = new Map();

    for (const line of lines) {
      const cols = line.split("\t");
      const commit = cols[1];
      const composite = Number.parseFloat(cols[5] ?? "0");
      const status = cols[6];

      if (status !== "ok" || composite === 0) {
        continue;
      }

      if (!runs.has(commit)) {
        runs.set(commit, []);
      }

      runs.get(commit).push(composite);
    }

    // Find the best average across all runs
    let best = 0;

    for (const scores of runs.values()) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

      if (avg > best) {
        best = avg;
      }
    }

    return best;
  } catch {
    return 0;
  }
}

async function ensureCachedData(design, log) {
  const slug = slugify(design.name);
  const cacheFile = path.join(CACHE_DIR, `${slug}.json`);
  // --refresh re-caches ALL designs
  // --refresh=<name> re-caches only matching design (substring match on slug)
  const refreshArg = process.argv.find((a) => a.startsWith("--refresh"));
  const refreshTarget = refreshArg?.includes("=")
    ? refreshArg.split("=")[1].toLowerCase()
    : null;
  const shouldRefresh =
    refreshArg && (!refreshTarget || slug.includes(refreshTarget));

  if (!shouldRefresh) {
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
      log("Using cached MCP data", { design: design.name });
      return cached;
    } catch {
      // no cache, fetch fresh
    }
  }

  log("Fetching fresh MCP data (will cache for future runs)", {
    design: design.name,
  });

  const { parseFigmaUrl } = await import("../lib/parse-figma-url.js");
  const { FigmaClient } = await import("../lib/figma-client.js");

  const target = parseFigmaUrl(design.url);
  const figma = new FigmaClient({
    mcpUrl: process.env.FIGMA_MCP_URL ?? "http://localhost:3845/mcp",
    log,
  });

  try {
    await figma.connect();

    const pageMetadata = await figma.getMetadata(target.nodeId);

    // Resolve feature node ID from page metadata if feature selector given
    let featureNodeId = target.nodeId;

    if (design.feature) {
      // Use the same feature detection as the CLI — parse XML into a tree, then use detectFeatures
      const pageNode = parseMetadataXml(pageMetadata);

      if (pageNode) {
        const detection = detectFeatures(pageNode);
        const selected = selectFeature(detection.features, design.feature);

        if (selected) {
          featureNodeId = selected.nodeId;
        }
      }
    }

    const [designContext, featureMetadata, variables] = await Promise.all([
      figma.getDesignContext(featureNodeId).catch(() => null),
      figma.getMetadata(featureNodeId).catch(() => null),
      figma.getVariableDefs(featureNodeId).catch(() => null),
    ]);

    // Expand annotation instances to cache their interior text
    const expandedInstances = {};
    const featureNode = parseMetadataXml(featureMetadata);

    if (featureNode) {
      const instanceIds = findInstanceIds(
        featureNode,
        /annotation|callout|note|button/,
      );

      if (instanceIds.length > 0) {
        log("Expanding annotation instances for cache", {
          count: instanceIds.length,
        });

        // get_metadata returns self-closing for instances, but get_design_context
        // returns the full code with text content — extract text from that
        const expanded = await Promise.all(
          instanceIds.map((id) => figma.getDesignContext(id).catch(() => null)),
        );

        for (let i = 0; i < instanceIds.length; i++) {
          if (expanded[i]) {
            expandedInstances[instanceIds[i]] = expanded[i];
          }
        }
      }
    }

    // Screenshot
    const screenshotDir = path.join(CACHE_DIR, slug);
    await fs.mkdir(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, "screenshot.png");
    await figma.getScreenshot(featureNodeId, screenshotPath).catch(() => null);

    // Per-frame screenshots: classify children, screenshot each screen frame
    const frameScreenshots = {};

    if (featureNode) {
      const { screens } = classifyChildFrames(featureNode);

      if (screens.length > 0) {
        log("Screenshotting individual frames", { count: screens.length });

        for (const screen of screens) {
          const framePath = path.join(
            screenshotDir,
            `frame-${screen.nodeId.replace(":", "-")}.png`,
          );
          const saved = await figma
            .getScreenshot(screen.nodeId, framePath)
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

        log("Frame screenshots captured", {
          captured: Object.keys(frameScreenshots).length,
          total: screens.length,
        });
      }
    }

    const cached = {
      fetchedAt: new Date().toISOString(),
      designUrl: design.url,
      featureNodeId,
      pageMetadata,
      featureMetadata,
      designContext,
      variables,
      screenshotPath,
      frameScreenshots,
      expandedInstances,
    };

    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
      cacheFile,
      JSON.stringify(cached, null, 2) + "\n",
      "utf8",
    );
    log("MCP data cached", { file: cacheFile });

    return cached;
  } finally {
    await figma.close();
  }
}

async function buildBriefFromCache(cached, design, log) {
  // All imports are at the top of the file (static)

  const targetNode = parseMetadataXml(cached.featureMetadata);
  const pageNode = parseMetadataXml(cached.pageMetadata);
  const overviewNotes = pageNode ? extractOverviewNotes(pageNode) : [];

  // Extract text from expanded annotation instances (design context code)
  // and add as synthetic TEXT children so text-intent.js can find them
  if (targetNode && cached.expandedInstances) {
    for (const [instanceId, code] of Object.entries(cached.expandedInstances)) {
      if (!code || typeof code !== "string") {
        continue;
      }

      // Extract visible text content from the design context code
      // Look for text between > and < that isn't a tag or attribute
      const boilerplate =
        /SUPER CRITICAL|IMPORTANT:|generated React|Tailwind|target project|data-node-id|data-name|className|localhost:\d+/i;
      const textMatches = [...code.matchAll(/>([^<]{10,})</g)]
        .map((m) => m[1].trim())
        .filter((t) => t && !boilerplate.test(t) && !/^[{}\s()`;]+$/.test(t));

      if (textMatches.length === 0) {
        continue;
      }

      // Add as TEXT children to the instance node
      walkNodeTree(targetNode, (n) => {
        if (n.id === instanceId) {
          if (!n.children) {
            n.children = [];
          }

          for (const text of textMatches) {
            n.children.push({
              type: "TEXT",
              id: `${instanceId}-text`,
              name: text,
              characters: text,
              children: [],
            });
          }

          return false;
        }
      });
    }
  }

  if (!targetNode) {
    throw new Error("Cached metadata could not be parsed into a node tree");
  }

  // Load component manifest if specified
  let componentManifest = null;

  if (design.componentManifest) {
    try {
      componentManifest = JSON.parse(
        await fs.readFile(design.componentManifest, "utf8"),
      );
    } catch {
      log("Component manifest not found, skipping", {
        path: design.componentManifest,
      });
    }
  }

  const target = {
    figmaUrl: cached.designUrl,
    fileKey: "",
    nodeId: cached.featureNodeId,
  };

  const outDir = path.join(
    PROJECT_ROOT,
    ".artifacts",
    "autoresearch",
    slugify(design.name),
  );
  const outputDir = path.join(outDir, slugify(targetNode.name ?? design.name));

  await fs.mkdir(outputDir, { recursive: true });

  // Copy cached screenshot if available
  let screenshotPath = null;

  if (cached.screenshotPath) {
    try {
      screenshotPath = path.join(outputDir, "screenshot.png");
      await fs.copyFile(cached.screenshotPath, screenshotPath);
    } catch {
      screenshotPath = null;
    }
  }

  // Use LLM-enriched data if available (Layer 2), fall back to raw design context
  let rawDesignContext = null;

  if (cached.enriched) {
    rawDesignContext = {
      summary: [
        ...(cached.enriched.uiText?.length
          ? [{ kind: "ui-text", items: cached.enriched.uiText }]
          : []),
        ...(cached.enriched.components?.length
          ? [{ kind: "react-components", items: cached.enriched.components }]
          : []),
        ...(cached.enriched.layout
          ? [{ kind: "layout", preview: cached.enriched.layout }]
          : []),
        ...(cached.enriched.states?.length
          ? [{ kind: "states", items: cached.enriched.states }]
          : []),
        ...(cached.enriched.accessibility?.length
          ? [{ kind: "accessibility", items: cached.enriched.accessibility }]
          : []),
      ],
    };

    // Inject behavioral descriptions as additional overview notes
    if (cached.enriched.behaviors?.length) {
      for (const behavior of cached.enriched.behaviors) {
        overviewNotes.push({
          kind: "enriched-behavior",
          text: behavior,
          nodeId: "enriched",
          nodeName: "LLM extraction",
          sourceFrame: "enriched",
          confidence: 0.9,
        });
      }
    }
  } else if (cached.designContext) {
    rawDesignContext = { code: cached.designContext };
  }

  // Copy frame screenshots from cache to output dir
  let frameScreenshots = null;

  if (
    cached.frameScreenshots &&
    Object.keys(cached.frameScreenshots).length > 0
  ) {
    frameScreenshots = {};

    for (const [nodeId, frame] of Object.entries(cached.frameScreenshots)) {
      try {
        const destPath = path.join(outputDir, path.basename(frame.path));
        await fs.copyFile(frame.path, destPath);
        frameScreenshots[nodeId] = { ...frame, path: destPath };
      } catch {
        // Frame screenshot missing from cache — skip
      }
    }
  }

  const brief = buildBrief({
    target,
    node: targetNode,
    rawNodePayload: null,
    comments: [],
    devResources: [],
    imageFillMap: {},
    screenshotPath,
    rawDesignContext,
    rawVariables: cached.variables,
    rawCodeConnect: null,
    rawMetadata: null,
    strictTags: false,
    maxComments: 20,
    componentManifest,
    flowNotes: [],
    overviewNotes,
    frameScreenshots,
  });

  const prompt = buildPrompt(brief);

  await fs.writeFile(
    path.join(outputDir, "brief.json"),
    JSON.stringify(brief, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(outputDir, "prompt.md"), prompt + "\n", "utf8");

  return { outputDir, brief, prompt };
}

async function main() {
  const log = createLogger(false); // never verbose in the loop
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null;

  const fixtures = JSON.parse(await fs.readFile(FIXTURES_PATH, "utf8"));
  const commit = await getGitHash();
  const incumbent = await getIncumbent();
  let totalComposite = 0;
  let designCount = 0;

  await ensureResultsHeader();

  for (const design of fixtures.designs) {
    const slug = slugify(design.name);

    try {
      const cached = await ensureCachedData(design, log);
      const result = await buildBriefFromCache(cached, design, log);

      const verification = await runVerification(result.outputDir, {
        anthropicApiKey,
        model: process.env.FIGMA_BRIEF_MODEL ?? "claude-sonnet-4-6",
        log,
      });

      designCount++;

      const brief = result.brief;

      console.log(`\n=== ${design.name} ===`);
      console.log(`  Structural: ${verification.structuralScore.toFixed(3)}`);
      console.log(`  Composite:  ${verification.composite.toFixed(3)}`);
      console.log(`  Descendants: ${brief.totalDescendants}`);
      console.log(
        `  Layout nodes: ${brief.visual?.layoutSummary?.length ?? 0}`,
      );
      console.log(`  Instances: ${brief.structure?.instances?.length ?? 0}`);
      console.log(
        `  Manifest matches: ${brief.codegrounding?.manifestMatches?.length ?? 0}`,
      );
      console.log(
        `  Tagged text: ${brief.intent?.taggedTextNodes?.length ?? 0}`,
      );
      console.log(
        `  Inferred notes: ${brief.intent?.inferredNotes?.length ?? 0}`,
      );
      console.log(
        `  Unique notes: ${new Set((brief.intent?.inferredNotes ?? []).map((n) => n.text)).size}`,
      );
      console.log(`  Variables: ${brief.structure?.variables?.length ?? 0}`);

      // Write judge prompt for the agent to evaluate
      const judgeDir = path.join(PROJECT_ROOT, "autoresearch");
      const judgePath = path.join(judgeDir, `judge-${slug}.md`);
      const judgePrompt = [
        `# LLM Judge: ${design.name}`,
        "",
        "Read this brief and the screenshot. Score 1-10: could you one-shot implement this design?",
        "",
        "## Criteria",
        "- 1-3: Missing critical info — layout unclear, no component guidance, no behavior",
        "- 4-6: Partial — structure visible but key interactions/states/mappings missing",
        "- 7-8: Good — could implement most, minor inferrable gaps",
        "- 9-10: One-shot — all context present, high fidelity possible",
        "",
        `## Brief summary`,
        `- ${brief.totalDescendants} descendants, ${brief.visual?.layoutSummary?.length ?? 0} in layout`,
        `- ${brief.structure?.instances?.length ?? 0} instances, ${brief.codegrounding?.manifestMatches?.length ?? 0} matched to codebase`,
        `- ${brief.intent?.taggedTextNodes?.length ?? 0} tagged, ${new Set((brief.intent?.inferredNotes ?? []).map((n) => n.text)).size} unique inferred notes`,
        `- ${brief.structure?.variables?.length ?? 0} variables`,
        "",
        `## Inferred notes captured:`,
        ...(brief.intent?.inferredNotes ?? [])
          .slice(0, 10)
          .map((n) => `- "${n.text.slice(0, 120)}"`),
        "",
        `## Open questions:`,
        ...(brief.openQuestions ?? []).map((q) => `- ${q}`),
        "",
        `Brief: ${result.outputDir}/brief.json`,
        `Screenshot: ${result.outputDir}/screenshot.png`,
        "",
        "After reading the brief, write your score (1-10) to:",
        `  echo <SCORE> > autoresearch/judge-score-${slug}.txt`,
        "",
      ].join("\n");

      await fs.writeFile(judgePath, judgePrompt, "utf8");

      let agentJudgeScore = 0;

      try {
        const scoreText = await fs.readFile(
          path.join(judgeDir, `judge-score-${slug}.txt`),
          "utf8",
        );
        agentJudgeScore = Number.parseInt(scoreText.trim(), 10) || 0;
      } catch {
        // No agent judge score yet — first iteration
      }

      // Composite: structural 40% + agent judge 60% (if available), else structural only
      const finalComposite =
        agentJudgeScore > 0
          ? Number(
              (
                verification.structuralScore * 0.4 +
                (agentJudgeScore / 10) * 0.6
              ).toFixed(3),
            )
          : verification.composite;

      totalComposite += finalComposite;

      if (agentJudgeScore > 0) {
        console.log(`  Agent judge: ${agentJudgeScore}/10`);
        console.log(`  Final composite: ${finalComposite.toFixed(3)}`);
      }

      await appendResult({
        commit,
        design: design.name,
        structural: verification.structuralScore,
        llmJudge: agentJudgeScore / 10,
        composite: finalComposite,
        status: "ok",
        description: "",
      });
    } catch (error) {
      console.error(`\n=== ${design.name} === FAILED`);
      console.error(`  ${error.message}`);

      await appendResult({
        commit,
        design: design.name,
        structural: 0,
        llmJudge: 0,
        composite: 0,
        status: "error",
        description: error.message.slice(0, 200),
      });
    }
  }

  if (designCount > 0) {
    const avgComposite = totalComposite / designCount;
    console.log(`\n=== RESULT ===`);
    console.log(`COMPOSITE_SCORE=${avgComposite.toFixed(3)}`);
    console.log(`INCUMBENT=${incumbent.toFixed(3)}`);
    console.log(`DELTA=${(avgComposite - incumbent).toFixed(3)}`);

    if (avgComposite > incumbent) {
      console.log(`VERDICT=improved`);
    } else {
      console.log(`VERDICT=no_improvement`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
