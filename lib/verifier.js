import fs from "node:fs/promises";
import path from "node:path";
import { deduplicateTexts } from "./text-utils.js";

function computeStructuralScore(brief) {
  const totalDescendants = brief.totalDescendants ?? 1;
  const layoutCount = (brief.visual?.layoutSummary ?? []).length;
  const instances = brief.structure?.instances ?? [];
  const manifestMatches = brief.codegrounding?.manifestMatches ?? [];
  const flowNotes = brief.behavior?.flowNotes ?? [];

  const allIntent = [
    ...(brief.intent?.taggedTextNodes ?? []),
    ...(brief.intent?.inferredNotes ?? []),
    ...(brief.intent?.relevantComments ?? []),
    ...(brief.intent?.overviewNotes ?? []),
  ];
  const uniqueIntentCount = deduplicateTexts(allIntent).length;

  const coverageRatio = Math.min(
    1,
    layoutCount / Math.max(1, totalDescendants),
  );
  const matchRatio =
    instances.length > 0 ? manifestMatches.length / instances.length : 0;
  const intentDensity = Math.min(
    1,
    uniqueIntentCount / Math.max(1, totalDescendants / 100),
  );
  const hasFrameScreenshots =
    brief.visual?.frameScreenshots &&
    Object.keys(brief.visual.frameScreenshots).length > 0;
  const hasScreenshot = brief.visual?.screenshotPath
    ? hasFrameScreenshots
      ? 1
      : 0.7
    : 0;
  const behaviorPattern =
    /modal|sheet|gesture|navigate|tapping|swipe|drag|flow|transition|screen|bottom sheet|overlay/i;
  const inferredNotes = brief.intent?.inferredNotes ?? [];
  const hasBehavior =
    flowNotes.length > 0 ||
    (brief.intent?.overviewNotes ?? []).length > 0 ||
    inferredNotes.some((n) => behaviorPattern.test(n.text))
      ? 1
      : 0;

  return Number(
    (
      coverageRatio * 0.2 +
      matchRatio * 0.2 +
      intentDensity * 0.2 +
      hasScreenshot * 0.2 +
      hasBehavior * 0.2
    ).toFixed(3),
  );
}

async function toBase64(filePath) {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

async function runLlmJudge(
  promptMd,
  screenshotPath,
  { anthropicApiKey, model = "claude-sonnet-4-6" },
) {
  const content = [{ type: "text", text: promptMd }];

  if (screenshotPath) {
    try {
      const imgBase64 = await toBase64(screenshotPath);
      content.unshift({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: imgBase64 },
      });
    } catch {
      // screenshot missing — judge without it
    }
  }

  content.push({
    type: "text",
    text: `You are evaluating a design implementation brief. Given ONLY the brief above (and the screenshot if provided), rate how confidently you could one-shot implement this design on a scale of 1-10.

Criteria:
- 1-3: Missing critical information — layout unclear, no component guidance, no behavioral notes
- 4-6: Partial — structure is there but key interactions, states, or component mappings are missing
- 7-8: Good — could implement most of it, minor gaps that are easy to infer
- 9-10: Excellent — could one-shot with high fidelity, all context present

Respond with ONLY a JSON object (no markdown fences):
{
  "score": <1-10>,
  "missing": ["list of specific things missing or unclear"],
  "strengths": ["list of what the brief does well"]
}`,
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM judge call failed: ${response.status}\n${body}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text ?? "";

  try {
    return JSON.parse(text);
  } catch {
    // Try extracting JSON from text
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return {
      score: 0,
      missing: ["Failed to parse LLM judge response"],
      strengths: [],
    };
  }
}

export async function runVerification(
  briefDir,
  { anthropicApiKey, model, log = () => {} } = {},
) {
  const brief = JSON.parse(
    await fs.readFile(path.join(briefDir, "brief.json"), "utf8"),
  );

  const structuralScore = computeStructuralScore(brief);
  log("Structural score", { structuralScore });

  let llmResult = null;

  if (anthropicApiKey) {
    const promptMd = await fs.readFile(
      path.join(briefDir, "prompt.md"),
      "utf8",
    );
    const screenshotPath = brief.visual?.screenshotPath;

    log("Running LLM judge", { model });
    llmResult = await runLlmJudge(promptMd, screenshotPath, {
      anthropicApiKey,
      model,
    });
    log("LLM judge result", {
      score: llmResult.score,
      missing: llmResult.missing?.length ?? 0,
    });
  }

  // When no API key, use structural score only — the agent running the loop
  // can evaluate the brief inline (it IS an LLM) and provide its own judgment.
  const llmNormalized = llmResult ? llmResult.score / 10 : null;
  const composite =
    llmNormalized !== null
      ? Number((structuralScore * 0.4 + llmNormalized * 0.6).toFixed(3))
      : structuralScore;

  return {
    structuralScore,
    llmJudgeScore: llmNormalized ?? 0,
    llmMissing: llmResult?.missing ?? [],
    llmStrengths: llmResult?.strengths ?? [],
    composite,
  };
}

export { computeStructuralScore };
