#!/usr/bin/env node

// Validates a generated brief is ready for one-shot implementation.
// Run after brief generation, before feeding to an implementing agent.
//
// Usage:
//   node bin/validate-brief.js --brief-dir .artifacts/autoresearch/desktop-line/desktop-line

import fs from "node:fs/promises";
import path from "node:path";

const CHECKS = [];
const warnings = [];
const errors = [];

function pass(name, detail) {
  CHECKS.push({ name, status: "PASS", detail });
}

function warn(name, detail) {
  CHECKS.push({ name, status: "WARN", detail });
  warnings.push({ name, detail });
}

function fail(name, detail) {
  CHECKS.push({ name, status: "FAIL", detail });
  errors.push({ name, detail });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(p) {
  try {
    const stat = await fs.stat(p);
    return stat.size;
  } catch {
    return 0;
  }
}

async function validateBrief(briefDir) {
  const briefPath = path.join(briefDir, "brief.json");
  const promptPath = path.join(briefDir, "prompt.md");

  // 1. Brief file exists
  if (!(await fileExists(briefPath))) {
    fail("brief.json exists", `Not found at ${briefPath}`);
    return;
  }
  pass("brief.json exists", briefPath);

  const brief = JSON.parse(await fs.readFile(briefPath, "utf8"));

  // 2. Prompt file exists
  if (await fileExists(promptPath)) {
    const promptSize = await fileSize(promptPath);
    pass("prompt.md exists", `${(promptSize / 1024).toFixed(0)}KB`);
  } else {
    fail("prompt.md exists", "Missing — agent has no prompt to consume");
  }

  // 3. Overview screenshot
  const screenshotPath = brief.visual?.screenshotPath;

  if (screenshotPath && (await fileExists(screenshotPath))) {
    const size = await fileSize(screenshotPath);

    if (size > 50000) {
      pass("Overview screenshot", `${(size / 1024).toFixed(0)}KB`);
    } else {
      warn(
        "Overview screenshot",
        `Only ${(size / 1024).toFixed(0)}KB — may be a placeholder or error image`,
      );
    }
  } else {
    warn("Overview screenshot", "Missing — agent has no visual reference");
  }

  // 4. Per-frame screenshots (critical for visual fidelity)
  const frameScreenshots = brief.visual?.frameScreenshots;

  if (frameScreenshots && Object.keys(frameScreenshots).length > 0) {
    let validFrames = 0;
    let tooSmall = 0;

    for (const frame of Object.values(frameScreenshots)) {
      if (frame.path && (await fileExists(frame.path))) {
        const size = await fileSize(frame.path);

        if (size > 50000) {
          validFrames++;
        } else {
          tooSmall++;
        }
      }
    }

    const total = Object.keys(frameScreenshots).length;

    if (validFrames === total) {
      pass("Per-frame screenshots", `${validFrames} frames, all readable`);
    } else if (validFrames > 0) {
      warn(
        "Per-frame screenshots",
        `${validFrames}/${total} valid (${tooSmall} too small or missing)`,
      );
    } else {
      fail(
        "Per-frame screenshots",
        "All frame screenshots missing or too small — visual matching will fail",
      );
    }
  } else {
    fail(
      "Per-frame screenshots",
      "None — agent will only see the zoomed-out overview. Visual matching will fail.",
    );
  }

  // 5. UI states
  const designSummary = brief.visual?.designContextSummary ?? [];
  const statesSection = designSummary.find((s) => s.kind === "states");

  if (statesSection?.items?.length > 0) {
    pass("UI states", `${statesSection.items.length} states defined`);
  } else {
    warn(
      "UI states",
      "No states extracted — agent won't know which screens to implement",
    );
  }

  // 6. Behavioral rules
  const inferredNotes = brief.intent?.inferredNotes ?? [];
  const overviewNotes = brief.intent?.overviewNotes ?? [];
  const behaviorCount = overviewNotes.filter(
    (n) => n.kind === "enriched-behavior",
  ).length;
  const totalBehaviors = behaviorCount + inferredNotes.length;

  if (totalBehaviors > 5) {
    pass("Behavioral rules", `${totalBehaviors} rules/notes`);
  } else if (totalBehaviors > 0) {
    warn(
      "Behavioral rules",
      `Only ${totalBehaviors} — may miss interaction details`,
    );
  } else {
    warn("Behavioral rules", "None — agent will guess interactions");
  }

  // 7. Component matches
  const manifestMatches = brief.codegrounding?.manifestMatches ?? [];

  if (manifestMatches.length > 0) {
    const matchedCount = manifestMatches.filter((m) => m.match).length;
    pass("Component matches", `${matchedCount} matched`);
  } else {
    warn(
      "Component matches",
      "None — no component manifest provided or no matches found",
    );
  }

  // 8. Design tokens
  const variables = brief.structure?.variables ?? [];

  if (variables.length > 5) {
    pass("Design tokens", `${variables.length} tokens`);
  } else if (variables.length > 0) {
    warn("Design tokens", `Only ${variables.length} — may miss colors/spacing`);
  } else {
    warn("Design tokens", "None — agent will hardcode values");
  }

  // 9. UI text (from enrichment)
  const uiTextSection = designSummary.find((s) => s.kind === "ui-text");

  if (uiTextSection?.items?.length > 0) {
    pass("UI text content", `${uiTextSection.items.length} strings`);
  } else {
    warn("UI text content", "No enriched text — agent may use wrong copy");
  }

  // 10. Quality score
  const quality = brief.quality;

  if (quality?.overall > 0.7) {
    pass("Quality score", `${quality.overall} (above 0.7 threshold)`);
  } else if (quality?.overall > 0.5) {
    warn(
      "Quality score",
      `${quality.overall} — below 0.7, brief may have gaps`,
    );
  } else {
    fail(
      "Quality score",
      `${quality?.overall ?? "N/A"} — too low for one-shot`,
    );
  }

  // Print results
  console.log("\n  Brief Validation Report\n");

  for (const check of CHECKS) {
    const icon =
      check.status === "PASS"
        ? "\x1b[32m✓\x1b[0m"
        : check.status === "WARN"
          ? "\x1b[33m⚠\x1b[0m"
          : "\x1b[31m✗\x1b[0m";
    console.log(`  ${icon} ${check.name}: ${check.detail}`);
  }

  console.log("");

  if (errors.length > 0) {
    console.log(
      `  \x1b[31mNOT READY\x1b[0m — ${errors.length} critical issue(s) must be fixed before one-shot:`,
    );

    for (const e of errors) {
      console.log(`    - ${e.name}: ${e.detail}`);
    }

    process.exitCode = 1;
  } else if (warnings.length > 0) {
    console.log(
      `  \x1b[33mREADY WITH WARNINGS\x1b[0m — ${warnings.length} issue(s) may affect quality:`,
    );

    for (const w of warnings) {
      console.log(`    - ${w.name}: ${w.detail}`);
    }
  } else {
    console.log(
      "  \x1b[32mREADY\x1b[0m — brief passes all checks for one-shot implementation",
    );
  }

  console.log("");
}

const briefDir =
  process.argv[2] ??
  process.argv.find((a) => a.startsWith("--brief-dir="))?.split("=")[1];

if (!briefDir) {
  console.error("Usage: node bin/validate-brief.js <brief-dir>");
  console.error("       node bin/validate-brief.js --brief-dir=<path>");
  process.exit(1);
}

validateBrief(briefDir).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
