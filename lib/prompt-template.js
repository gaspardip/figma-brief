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

function buildComponentSection(brief) {
  const manifestMatches = brief.codegrounding?.manifestMatches ?? [];

  if (manifestMatches.length === 0) {
    return [];
  }

  const grouped = new Map();

  for (const m of manifestMatches) {
    const key = `${m.match.name}|${m.match.path}|${m.match.confidence}`;

    if (!grouped.has(key)) {
      grouped.set(key, { match: m.match, instanceNames: new Set() });
    }

    grouped.get(key).instanceNames.add(m.instanceName);
  }

  const lines = [
    "## REQUIRED: Component Reuse",
    "",
    "You MUST use these existing codebase components. Do NOT build custom versions.",
    "",
  ];

  for (const { match, instanceNames } of grouped.values()) {
    const names = [...instanceNames].join(", ");
    const count = instanceNames.size > 1 ? ` (×${instanceNames.size})` : "";
    const props = match.props?.length
      ? ` — props: ${match.props.join(", ")}`
      : "";
    lines.push(`- **${match.name}** (\`${match.path}\`)${count}${props}`);
    lines.push(`  Figma instances: ${names}`);
  }

  lines.push("");
  return lines;
}

function buildStateSection(brief) {
  const designSummary = brief.visual?.designContextSummary ?? [];
  const statesSection = designSummary.find((s) => s.kind === "states");
  const overviewNotes = brief.intent?.overviewNotes ?? [];
  const inferredNotes = brief.intent?.inferredNotes ?? [];
  const enrichedBehaviors = overviewNotes.filter(
    (n) => n.kind === "enriched-behavior",
  );
  // Only include inferred notes that look like complete sentences, not JSX fragments
  const cleanInferred = inferredNotes.filter((n) => {
    const t = n.text.trim();
    return (
      t.length > 30 &&
      /[.!?]$/.test(t) &&
      /^[A-Z]/.test(t) &&
      !t.startsWith("{")
    );
  });
  const allBehaviors = [...enrichedBehaviors, ...cleanInferred];

  if (!statesSection?.items?.length && allBehaviors.length === 0) {
    return [];
  }

  const lines = [
    "## REQUIRED: UI States and Transitions",
    "",
    "Your implementation MUST handle every state listed below. For each state,",
    "define what triggers it, what the user sees, and what actions are available.",
    "",
  ];

  if (statesSection?.items?.length) {
    lines.push("**States:**");

    for (const state of statesSection.items) {
      lines.push(`- ${state}`);
    }

    lines.push("");
  }

  if (allBehaviors.length > 0) {
    // Filter out JSX fragments and noise from regex extraction
    const cleanBehaviors = allBehaviors.filter((note) => {
      const t = note.text;
      return (
        t.length > 15 &&
        !t.startsWith("{") &&
        !t.startsWith('"') &&
        !t.startsWith(":") &&
        !/^[,.)}\s]/.test(t) &&
        !/className|data-node/i.test(t)
      );
    });

    if (cleanBehaviors.length > 0) {
      lines.push(
        "**Behavioral rules (from designer notes — these are NOT optional):**",
      );

      for (const note of cleanBehaviors) {
        lines.push(`- ${note.text}`);
      }

      lines.push("");
    }
  }

  lines.push(
    "You MUST define state transitions in your plan before writing code.",
    "Map: trigger → state change → UI update → available actions.",
    "",
  );

  return lines;
}

function buildTextSection(brief) {
  const designSummary = brief.visual?.designContextSummary ?? [];
  const textSection = designSummary.find((s) => s.kind === "ui-text");

  if (!textSection?.items?.length) {
    return [];
  }

  const lines = [
    "## REQUIRED: UI Text (use i18n keys)",
    "",
    "Text strings visible in this design are listed below.",
    "For feature-specific text, create i18n keys in a new translation namespace.",
    "For common UI text (save, cancel, close, etc.), check if keys already exist before creating duplicates.",
    "Never hardcode user-visible strings.",
    "",
  ];

  for (const text of textSection.items) {
    lines.push(`- "${text}"`);
  }

  lines.push("");
  return lines;
}

function buildAccessibilitySection(brief) {
  const designSummary = brief.visual?.designContextSummary ?? [];
  const a11ySection = designSummary.find((s) => s.kind === "accessibility");
  const instances = brief.structure?.instances ?? [];
  const hasModal = instances.some(
    (i) =>
      /modal|dialog/i.test(i.name) ||
      brief.intent?.inferredNotes?.some((n) => /modal/i.test(n.text)),
  );
  const hasToast = instances.some(
    (i) =>
      /toast|banner|notification/i.test(i.name) ||
      brief.intent?.inferredNotes?.some((n) => /toast/i.test(n.text)),
  );

  const lines = [
    "## REQUIRED: Accessibility",
    "",
    "You MUST implement these accessibility requirements:",
    "",
  ];

  if (hasModal) {
    lines.push(
      "**Modal/Dialog:**",
      '- `role="dialog"` + `aria-modal="true"`',
      "- Focus trap: tab cycles within modal, no escape to background",
      "- Escape key dismisses the modal",
      "- Focus returns to trigger element on close",
      "- `aria-labelledby` pointing to the modal title",
      "",
    );
  }

  if (hasToast) {
    lines.push(
      "**Toast/Notification:**",
      '- `role="status"` or `role="alert"` depending on urgency',
      '- `aria-live="polite"` for non-blocking, `"assertive"` for blocking',
      "- Must be announced by screen readers without stealing focus",
      "",
    );
  }

  lines.push(
    "**General:**",
    "- All interactive elements must be keyboard-accessible",
    "- All images/icons must have `alt` text or `aria-label`",
    "- Color must not be the only way to convey information",
    "",
  );

  if (a11ySection?.items?.length) {
    lines.push("**Design-specific a11y notes:**");

    for (const a of a11ySection.items) {
      lines.push(`- ${a}`);
    }

    lines.push("");
  }

  return lines;
}

function buildVisualSection(brief) {
  const designSummary = brief.visual?.designContextSummary ?? [];
  const layoutSection = designSummary.find((s) => s.kind === "layout");
  const variables = brief.structure?.variables ?? [];

  const lines = [
    "## REQUIRED: Visual Fidelity",
    "",
    "Match the reference screenshot precisely. Do NOT guess colors, spacing, or typography.",
    "",
  ];

  if (brief.visual?.screenshotPath) {
    lines.push(
      `**Reference screenshot:** \`${brief.visual.screenshotPath}\``,
      "Study this screenshot before writing ANY CSS/styles.",
      "",
    );
  }

  if (layoutSection?.preview) {
    lines.push(`**Layout:** ${layoutSection.preview}`, "");
  }

  lines.push(
    "**Styling rules:**",
    "- Use ONLY the project's design tokens (CSS variables) for colors, spacing, fonts",
    "- Do NOT hardcode hex colors, pixel values, or font names",
    "- Do NOT use Tailwind utility classes if the project uses LESS/CSS variables",
    "- Match the project's existing component styling patterns exactly",
    "- Check adjacent components in the codebase for styling conventions",
    "",
  );

  if (variables.length > 0) {
    lines.push(
      `**Available design tokens** (${variables.length} total, showing first 20):`,
    );

    for (const v of variables.slice(0, 20)) {
      const val = v.value != null ? `: ${v.value}` : "";
      lines.push(`- \`${v.name}\`${val}`);
    }

    lines.push("");
  }

  return lines;
}

function buildDesignerContextSection(brief) {
  const overviewNotes = brief.intent?.overviewNotes ?? [];
  const inferredNotes = brief.intent?.inferredNotes ?? [];
  const flowNotes = brief.behavior?.flowNotes ?? [];

  const contextNotes = overviewNotes.filter(
    (n) => n.kind !== "enriched-behavior",
  );

  if (
    contextNotes.length === 0 &&
    inferredNotes.length === 0 &&
    flowNotes.length === 0
  ) {
    return [];
  }

  const lines = ["## Designer Intent", ""];

  const cleanContextNotes = contextNotes.filter((n) => {
    const t = n.text.trim();
    return t.length > 20 && /^[A-Z]/.test(t);
  });

  if (cleanContextNotes.length > 0) {
    lines.push("**Design rationale and context:**");

    for (const note of cleanContextNotes) {
      lines.push(`- ${note.text}`);
    }

    lines.push("");
  }

  const cleanInferredNotes = inferredNotes.filter((n) => {
    const t = n.text.trim();
    return (
      t.length > 20 &&
      /^[A-Z]/.test(t) &&
      /[.!?]$/.test(t) &&
      !t.startsWith("{") &&
      !/className|data-node/i.test(t)
    );
  });

  if (cleanInferredNotes.length > 0) {
    lines.push("**Notes extracted from the design:**");

    for (const note of cleanInferredNotes) {
      lines.push(`- ${note.text}`);
    }

    lines.push("");
  }

  if (flowNotes.length > 0) {
    lines.push("**User flow:**");

    for (const fl of flowNotes) {
      lines.push(
        `- ${fl.from.name} → ${fl.to.name}${fl.label ? `: ${fl.label}` : ""}`,
      );
    }

    lines.push("");
  }

  return lines;
}

function buildDataContractSection(brief) {
  const instances = brief.structure?.instances ?? [];
  const manifestMatches = brief.codegrounding?.manifestMatches ?? [];

  if (instances.length === 0) {
    return [];
  }

  const lines = [
    "## REQUIRED: Component Contracts",
    "",
    "Before writing code, define the props/events interface for each new component.",
    "Your plan MUST include:",
    "",
    "1. **Props interface** — what data each component receives (types, required vs optional)",
    "2. **Events/emits** — what each component emits to its parent",
    "3. **Integration point** — how the new components wire into the existing module/view",
    "4. **State management** — where the feature state lives (store, composable, local)",
    "",
  ];

  if (manifestMatches.length > 0) {
    const unmatchedCount = instances.length - manifestMatches.length;

    if (unmatchedCount > 0) {
      lines.push(
        `Note: ${manifestMatches.length}/${instances.length} Figma instances matched existing components.`,
        `${unmatchedCount} instances need new components or are design-only elements (icons, decorators).`,
        "",
      );
    }
  }

  return lines;
}

export function buildPrompt(brief) {
  const lines = [
    `# Implementation Brief: ${brief.target?.nodeName ?? "Figma Design"}`,
    "",
    `Figma URL: ${brief.target?.figmaUrl ?? "N/A"}`,
    "",
    "---",
    "",
    "## Instructions",
    "",
    "BEFORE WRITING ANY CODE, create a detailed implementation plan that addresses",
    "every REQUIRED section below. Do not start coding until the plan covers:",
    "- Every UI state and the transitions between them",
    "- Every new component with its props/events contract",
    "- Which existing components are reused and how",
    "- All i18n keys, accessibility requirements, and design token mappings",
    "",
    "Only after the plan is complete, implement it following the sections below IN ORDER.",
    "Do NOT skip sections. Do NOT invent interactions not described here.",
    "Do NOT call Figma MCP tools — all context you need is in this brief.",
    "",
    "**First step:** Read the reference screenshot below and describe what you see —",
    "layout structure, component types, colors, spacing, visual hierarchy.",
    "Ground your plan in what the screenshot shows, not just the text descriptions.",
    "",
  ];

  if (brief.visionSummary) {
    lines.push("## Visual Analysis", "", brief.visionSummary, "");
  }

  // Required sections
  lines.push(...buildVisualSection(brief));
  lines.push(...buildComponentSection(brief));
  lines.push(...buildStateSection(brief));
  lines.push(...buildTextSection(brief));
  lines.push(...buildAccessibilitySection(brief));
  lines.push(...buildDataContractSection(brief));
  lines.push(...buildDesignerContextSection(brief));

  // Open questions
  if (brief.openQuestions?.length > 0) {
    lines.push("## Open Questions", "");

    for (const q of brief.openQuestions) {
      lines.push(`- ${q}`);
    }

    lines.push(
      "",
      "For each open question, choose the safest implementation and document your choice.",
      "",
    );
  }

  // Confidence
  lines.push(
    "## Confidence",
    "",
    `Overall: ${brief.confidence?.overall ?? "N/A"}`,
    `Visual: ${brief.confidence?.visual ?? "N/A"} | Structure: ${brief.confidence?.structure ?? "N/A"} | Behavior: ${brief.confidence?.behavior ?? "N/A"} | Content: ${brief.confidence?.content ?? "N/A"}`,
    "",
  );

  // Checklist
  lines.push(
    "## Pre-Implementation Checklist",
    "",
    "Before writing any code, your plan MUST explicitly address:",
    "",
    "- [ ] All UI states listed above with transitions between them",
    "- [ ] Component contracts (props, events) for every new component",
    "- [ ] Which existing components are reused (from the matches above)",
    "- [ ] i18n keys for every user-visible string",
    "- [ ] Accessibility: focus management, ARIA roles, keyboard navigation",
    "- [ ] Design tokens used for colors, spacing, typography (no hardcoded values)",
    "- [ ] Integration point: where the feature wires into the existing codebase",
    "- [ ] How the feature state is managed (store, composable, or local)",
    "",
  );

  // Key files hint
  const componentPaths = new Set();
  for (const m of brief.codegrounding?.manifestMatches ?? []) {
    if (m.match?.path) {
      componentPaths.add(m.match.path);
    }
  }

  if (componentPaths.size > 0) {
    lines.push(
      "## Suggested Starting Points",
      "",
      "Start by reading these files to understand existing patterns, then explore adjacent code as needed.",
      "",
      "**Matched components (read these first for API/style conventions):**",
    );

    for (const p of componentPaths) {
      lines.push(`- \`${p}\``);
    }

    lines.push("");

    // Detect patterns: if the design has modal/dialog/toast/banner behavior,
    // suggest studying similar existing components
    const allComponents = (brief.codegrounding?.manifestMatches ?? []).map(
      (m) => m.match?.name ?? "",
    );
    const allInstanceNames = (brief.structure?.instances ?? []).map(
      (i) => i.name?.toLowerCase() ?? "",
    );
    const allNotes = [
      ...(brief.intent?.inferredNotes ?? []),
      ...(brief.intent?.overviewNotes ?? []),
    ].map((n) => n.text?.toLowerCase() ?? "");
    const allSignals = [
      ...allComponents,
      ...allInstanceNames,
      ...allNotes,
    ].join(" ");

    const patterns = [];

    if (/modal|dialog/i.test(allSignals)) {
      patterns.push(
        "This design includes a modal/dialog. Study existing dialog components in the codebase for the base pattern.",
      );
    }

    if (/toast|banner|notification/i.test(allSignals)) {
      patterns.push(
        "This design includes a toast/banner. Study existing banner/notification components for the pattern.",
      );
    }

    if (/tooltip|popover/i.test(allSignals)) {
      patterns.push(
        "This design includes tooltips/popovers. Study existing tooltip components for positioning and dismiss patterns.",
      );
    }

    if (patterns.length > 0) {
      lines.push("**Patterns to follow:**");

      for (const p of patterns) {
        lines.push(`- ${p}`);
      }

      lines.push("");
    }
  }

  // Slim brief as reference
  lines.push(
    "## Full Brief (reference data)",
    "",
    "```json",
    JSON.stringify(createPromptBrief(brief), null, 2),
    "```",
  );

  return lines.join("\n");
}
