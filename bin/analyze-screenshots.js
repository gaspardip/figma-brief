#!/usr/bin/env node

// Layer 2.5: VLM analysis of per-frame screenshots.
// Reads each frame screenshot, sends to Anthropic API for visual description,
// writes descriptions back into the brief.
//
// Usage:
//   node bin/analyze-screenshots.js <brief-dir>
//   node bin/analyze-screenshots.js --force <brief-dir>
//
// Requires: ANTHROPIC_API_KEY environment variable

import fs from "node:fs/promises";
import path from "node:path";

const ANALYSIS_PROMPT = `Describe EXACTLY what you see in this UI screenshot with precision a developer needs to replicate it.

Include:
1. **Layout**: spatial arrangement — modal or inline? Full-width or centered? What's on top, left, right, center?
2. **Components**: every visible UI element — buttons (text, color, rounded/square), inputs, toggles, tabs, labels, icons, tags/badges
3. **Typography**: heading sizes vs body, font weights (bold, medium, regular), text colors, alignment
4. **Colors**: background colors, border colors, accent colors, button colors (be specific: hot pink, charcoal, light grey, etc.)
5. **Spacing**: padding around content areas, gaps between elements
6. **Visual details**: border radius, shadows, dividers, checkered transparency patterns, tag labels
7. **Interactive elements**: what looks clickable, selected/active states (e.g., which tab is active)
8. **Text content**: every visible text string, verbatim

Be concise but miss nothing.`;

async function callAnthropicVision(imagePath) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const imageData = await fs.readFile(imagePath);
  const base64 = imageData.toString("base64");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: base64 },
            },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API ${response.status}: ${error.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}

async function analyzeBrief(briefDir, force) {
  const briefPath = path.join(briefDir, "brief.json");
  const brief = JSON.parse(await fs.readFile(briefPath, "utf8"));

  const frameScreenshots = brief.visual?.frameScreenshots;

  if (!frameScreenshots || Object.keys(frameScreenshots).length === 0) {
    console.log("No per-frame screenshots to analyze.");
    return;
  }

  if (brief.visual?.frameAnalysis && !force) {
    console.log(
      `Already analyzed ${Object.keys(brief.visual.frameAnalysis).length} frames (use --force to redo)`,
    );
    return;
  }

  const frameAnalysis = {};
  const frames = Object.entries(frameScreenshots);

  console.log(
    `Analyzing ${frames.length} frame screenshots via Anthropic Vision...\n`,
  );

  for (const [nodeId, frame] of frames) {
    if (!frame.path) {
      continue;
    }

    // Try both the absolute path and relative to briefDir
    let fullPath = frame.path;
    const exists = await fs
      .access(fullPath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      fullPath = path.resolve(briefDir, path.basename(frame.path));
      const exists2 = await fs
        .access(fullPath)
        .then(() => true)
        .catch(() => false);

      if (!exists2) {
        console.log(`  SKIP ${frame.name} (file not found)`);
        continue;
      }
    }

    console.log(`  ${frame.name}...`);

    try {
      const description = await callAnthropicVision(fullPath);
      frameAnalysis[nodeId] = { name: frame.name, description };
      console.log(`    OK (${description.length} chars)`);
    } catch (error) {
      console.log(`    FAIL: ${error.message.slice(0, 100)}`);
    }
  }

  brief.visual.frameAnalysis = frameAnalysis;
  await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`);

  console.log(
    `\nDone. Analyzed ${Object.keys(frameAnalysis).length}/${frames.length} frames.`,
  );
}

const force = process.argv.includes("--force");
const briefDir = process.argv.find(
  (a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1],
);

if (!briefDir) {
  console.error("Usage: node bin/analyze-screenshots.js [--force] <brief-dir>");
  console.error("Requires: ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}

analyzeBrief(briefDir, force).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
