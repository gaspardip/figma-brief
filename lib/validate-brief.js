import fs from "node:fs/promises";

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

/**
 * Validate a brief for one-shot readiness.
 * Returns { checks: [...], warnings: [...], errors: [], ready: boolean }
 */
export async function validateBrief(brief) {
  const checks = [];
  const warnings = [];
  const errors = [];

  function pass(name, detail) {
    checks.push({ name, status: "PASS", detail });
  }
  function warn(name, detail) {
    checks.push({ name, status: "WARN", detail });
    warnings.push({ name, detail });
  }
  function fail(name, detail) {
    checks.push({ name, status: "FAIL", detail });
    errors.push({ name, detail });
  }

  // 1. Overview screenshot
  const screenshotPath = brief.visual?.screenshotPath;

  if (screenshotPath && (await fileExists(screenshotPath))) {
    const size = await fileSize(screenshotPath);

    if (size > 50000) {
      pass("Overview screenshot", `${(size / 1024).toFixed(0)}KB`);
    } else {
      warn(
        "Overview screenshot",
        `Only ${(size / 1024).toFixed(0)}KB — may be placeholder`,
      );
    }
  } else {
    warn("Overview screenshot", "Missing");
  }

  // 2. Per-frame screenshots
  const frameScreenshots = brief.visual?.frameScreenshots;

  if (frameScreenshots && Object.keys(frameScreenshots).length > 0) {
    let validFrames = 0;

    for (const frame of Object.values(frameScreenshots)) {
      if (frame.path && (await fileExists(frame.path))) {
        const size = await fileSize(frame.path);

        if (size > 50000) {
          validFrames++;
        }
      }
    }

    const total = Object.keys(frameScreenshots).length;

    if (validFrames === total) {
      pass("Per-frame screenshots", `${validFrames} frames`);
    } else if (validFrames > 0) {
      warn("Per-frame screenshots", `${validFrames}/${total} valid`);
    } else {
      fail("Per-frame screenshots", "All missing or too small");
    }
  } else {
    fail("Per-frame screenshots", "None — visual matching will fail");
  }

  // 3. UI states
  const designSummary = brief.visual?.designContextSummary ?? [];
  const statesSection = designSummary.find((s) => s.kind === "states");

  if (statesSection?.items?.length > 0) {
    pass("UI states", `${statesSection.items.length} states`);
  } else {
    warn("UI states", "None extracted");
  }

  // 4. Behavioral rules
  const overviewNotes = brief.intent?.overviewNotes ?? [];
  const inferredNotes = brief.intent?.inferredNotes ?? [];
  const behaviorCount =
    overviewNotes.filter((n) => n.kind === "enriched-behavior").length +
    inferredNotes.length;

  if (behaviorCount > 5) {
    pass("Behavioral rules", `${behaviorCount} rules`);
  } else if (behaviorCount > 0) {
    warn("Behavioral rules", `Only ${behaviorCount}`);
  } else {
    warn("Behavioral rules", "None");
  }

  // 5. Component matches
  const manifestMatches = brief.codegrounding?.manifestMatches ?? [];

  if (manifestMatches.length > 0) {
    pass(
      "Component matches",
      `${manifestMatches.filter((m) => m.match).length} matched`,
    );
  } else {
    warn("Component matches", "None");
  }

  // 6. Design tokens
  const variables = brief.structure?.variables ?? [];

  if (variables.length > 5) {
    pass("Design tokens", `${variables.length} tokens`);
  } else if (variables.length > 0) {
    warn("Design tokens", `Only ${variables.length}`);
  } else {
    warn("Design tokens", "None");
  }

  // 7. Comments
  const comments = brief.intent?.relevantComments ?? [];

  if (comments.length > 0) {
    pass("Designer comments", `${comments.length} comments`);
  } else {
    warn("Designer comments", "None — check if Figma file has comments");
  }

  // 8. UI text
  const uiTextSection = designSummary.find((s) => s.kind === "ui-text");

  if (uiTextSection?.items?.length > 0) {
    pass("UI text content", `${uiTextSection.items.length} strings`);
  } else {
    warn("UI text content", "No enriched text");
  }

  return {
    checks,
    warnings,
    errors,
    ready: errors.length === 0,
  };
}

export function formatValidationReport(result) {
  const lines = ["\n  Brief Validation Report\n"];

  for (const check of result.checks) {
    const icon =
      check.status === "PASS"
        ? "\x1b[32m✓\x1b[0m"
        : check.status === "WARN"
          ? "\x1b[33m⚠\x1b[0m"
          : "\x1b[31m✗\x1b[0m";
    lines.push(`  ${icon} ${check.name}: ${check.detail}`);
  }

  lines.push("");

  if (result.errors.length > 0) {
    lines.push(
      `  \x1b[31mNOT READY\x1b[0m — ${result.errors.length} critical issue(s):`,
    );

    for (const e of result.errors) {
      lines.push(`    - ${e.name}: ${e.detail}`);
    }
  } else if (result.warnings.length > 0) {
    lines.push(
      `  \x1b[33mREADY WITH WARNINGS\x1b[0m — ${result.warnings.length} issue(s) may affect quality`,
    );
  } else {
    lines.push("  \x1b[32mREADY\x1b[0m — brief passes all checks");
  }

  lines.push("");
  return lines.join("\n");
}
