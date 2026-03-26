function createPromptBrief(brief) {
  return {
    target: brief.target,
    totalDescendants: brief.totalDescendants,
    visual: {
      screenshotPath: brief.visual?.screenshotPath,
      designContextSummary: brief.visual?.designContextSummary,
      layoutNodeCount: brief.visual?.layoutSummary?.length ?? 0,
    },
    structure: {
      components: brief.structure?.components,
      instances: brief.structure?.instances,
      variables: (brief.structure?.variables ?? []).slice(0, 30),
    },
    intent: brief.intent,
    codegrounding: brief.codegrounding,
    behavior: brief.behavior,
    openQuestions: brief.openQuestions,
    confidence: brief.confidence,
    quality: brief.quality,
  };
}

function buildConfidenceSummary(confidence) {
  const lines = [`Overall confidence: ${confidence.overall}`];
  const axes = ["visual", "structure", "behavior", "content"];

  for (const axis of axes) {
    const value = confidence[axis];
    const label = value >= 0.8 ? "high" : value >= 0.6 ? "medium" : "low";
    lines.push(`  ${axis}: ${value} (${label})`);
  }

  const lowAxes = axes.filter((a) => confidence[a] < 0.6);

  if (lowAxes.length > 0) {
    lines.push(
      `⚠ Low confidence in: ${lowAxes.join(", ")} — verify these areas manually.`,
    );
  }

  return lines.join("\n");
}

export function buildPrompt(brief) {
  const lines = [
    "Implement the Figma node at this URL:",
    brief.target.figmaUrl,
    "",
  ];

  if (brief.visual?.screenshotPath) {
    lines.push(`Reference screenshot: ${brief.visual.screenshotPath}`, "");
  }

  if (brief.visionSummary) {
    lines.push("Visual analysis of screenshot:", brief.visionSummary, "");
  }

  // Render enriched design context sections (from LLM extraction)
  const designSummary = brief.visual?.designContextSummary ?? [];

  for (const section of designSummary) {
    if (section.kind === "ui-text" && section.items?.length) {
      lines.push("UI text content:");

      for (const text of section.items.slice(0, 30)) {
        lines.push(`  - "${text}"`);
      }

      lines.push("");
    } else if (section.kind === "states" && section.items?.length) {
      lines.push(
        `UI states: ${section.items.join(", ")}`,
        "",
      );
    } else if (section.kind === "layout" && section.preview) {
      lines.push(
        `Layout: ${section.preview}`,
        "",
      );
    } else if (section.kind === "accessibility" && section.items?.length) {
      lines.push("Accessibility:");

      for (const a of section.items) {
        lines.push(`  - ${a}`);
      }

      lines.push("");
    }
  }

  const manifestMatches = brief.codegrounding?.manifestMatches ?? [];

  if (manifestMatches.length > 0) {
    // Deduplicate: group by matched component, show count
    const grouped = new Map();

    for (const m of manifestMatches) {
      const key = `${m.match.name}|${m.match.path}|${m.match.confidence}`;

      if (!grouped.has(key)) {
        grouped.set(key, { match: m.match, instanceNames: new Set() });
      }

      grouped.get(key).instanceNames.add(m.instanceName);
    }

    lines.push("Codebase component matches:");

    for (const { match, instanceNames } of grouped.values()) {
      const names = [...instanceNames].join(", ");
      const count = instanceNames.size > 1 ? ` (×${instanceNames.size})` : "";
      lines.push(`  - ${match.name} (${match.path})${count} ← ${names}`);
    }

    lines.push("");
  }

  const flowNotes = brief.behavior?.flowNotes ?? [];

  const overviewNotes = brief.intent?.overviewNotes ?? [];

  if (overviewNotes.length > 0) {
    lines.push("Designer context (from overview):");

    for (const note of overviewNotes) {
      lines.push(`  ${note.text}`);
    }

    lines.push("");
  }

  if (flowNotes.length > 0) {
    lines.push("Behavioral flow:");

    for (const fl of flowNotes) {
      lines.push(
        `  ${fl.from.name} → ${fl.to.name}${fl.label ? `: ${fl.label}` : ""}`,
      );
    }

    lines.push("");
  }

  lines.push(
    "Confidence:",
    buildConfidenceSummary(brief.confidence),
    "",
    "Use the following priority order:",
    "1. Code Connect mappings and snippets",
    "2. Existing project components and tokens",
    "3. Figma design context, variables, layout, and screenshot",
    "4. Designer intent from tagged text nodes and comments",
    "",
    "Constraints:",
    "- Reuse existing components where possible",
    "- Match the Figma screenshot closely",
    "- Preserve semantic HTML and accessibility",
    "- Do not invent interactions not supported by the gathered context",
    "",
    "Structured brief:",
    "```json",
    JSON.stringify(createPromptBrief(brief), null, 2),
    "```",
    "",
    "If anything is ambiguous, list the ambiguity briefly and choose the safest implementation.",
  );

  return lines.join("\n");
}
