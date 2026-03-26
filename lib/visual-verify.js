import fs from "node:fs/promises";

export function extractClaims(brief) {
  const claims = [];

  for (const item of brief.visual?.layoutSummary ?? []) {
    if (item.layoutMode) {
      claims.push({
        source: "visual.layoutSummary",
        claim: `"${item.name}" uses ${item.layoutMode} layout${item.size ? ` (~${item.size.width}x${item.size.height}px)` : ""}`,
        severity: "medium",
      });
    }
  }

  for (const instance of brief.structure?.instances ?? []) {
    claims.push({
      source: "structure.instances",
      claim: `Contains component instance: "${instance.name}"`,
      severity: "medium",
    });
  }

  for (const tag of brief.intent?.taggedTextNodes ?? []) {
    claims.push({
      source: "intent.taggedTextNodes",
      claim: `${tag.kind}: ${tag.text}`,
      severity: tag.kind === "A11Y" ? "high" : "medium",
    });
  }

  for (const comment of brief.intent?.relevantComments ?? []) {
    if (comment.confidence >= 0.5) {
      claims.push({
        source: "intent.relevantComments",
        claim: `Designer comment: "${comment.text}"`,
        severity: "medium",
      });
    }
  }

  for (const note of brief.intent?.inferredNotes ?? []) {
    claims.push({
      source: "intent.inferredNotes",
      claim: `Designer note: "${note.text}"`,
      severity: "low",
    });
  }

  for (const cc of brief.codegrounding?.codeConnectComponents ?? []) {
    claims.push({
      source: "codegrounding.codeConnectComponents",
      claim: `Should use component: ${cc.codeComponent} (from ${cc.source})`,
      severity: "high",
    });
  }

  for (const ctx of brief.visual?.designContextSummary ?? []) {
    if (ctx.preview) {
      claims.push({
        source: "visual.designContextSummary",
        claim: `Design context (${ctx.kind}): ${ctx.preview}`,
        severity: "low",
      });
    }
  }

  return claims;
}

function buildVerificationPrompt(brief, claims) {
  return `You are verifying a UI implementation against a Figma design brief.

You have two images:
1. The FIRST image is the **Figma design** (the intended design).
2. The SECOND image is the **implementation** (what was actually built).

The target component is "${brief.target?.nodeName ?? "unknown"}".

Your job: verify each claim from the design brief against both images. For each claim, determine whether the implementation matches the design intent.

Focus on **obvious visual mismatches**: wrong layout direction, missing elements, wrong colors, missing components, broken hierarchy. Do NOT flag minor pixel differences, font rendering differences, or responsive width variations. Dimensions in the brief are guides, not exact requirements.

Claims to verify:
${claims.map((c, i) => `${i + 1}. [${c.severity}] ${c.claim}`).join("\n")}

Respond with ONLY a JSON object (no markdown fences, no commentary) in this exact format:
{
  "claims": [
    { "index": 0, "verified": true, "note": "Brief explanation" }
  ],
  "overallNotes": "One-paragraph summary of implementation quality"
}

Verify every single claim. Be honest but not pedantic. Size differences are acceptable; structural or color mismatches are not.`;
}

async function toBase64Image(input) {
  const buffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  return buffer.toString("base64");
}

export async function verifyAgainstBrief({
  brief,
  figmaScreenshot,
  implScreenshot,
  model,
  apiKey,
  log = () => {},
}) {
  const claims = extractClaims(brief);

  if (claims.length === 0) {
    return {
      claims: [],
      overallMatch: true,
      criticalMismatches: 0,
      overallNotes: "No verifiable claims extracted from brief.",
    };
  }

  log(`Extracted ${claims.length} claims from brief`);

  const prompt = buildVerificationPrompt(brief, claims);
  const figmaBase64 = await toBase64Image(figmaScreenshot);
  const implBase64 = await toBase64Image(implScreenshot);

  log(`Calling ${model} for visual verification`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: figmaBase64,
              },
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: implBase64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Verification API call failed: ${response.status} ${response.statusText}\n${body}`,
    );
  }

  const result = await response.json();
  const text = result.content?.[0]?.text ?? "";

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse verification response as JSON:\n${text}`);
  }

  const mergedClaims = claims.map((claim, i) => {
    const verification = parsed.claims?.find((c) => c.index === i) ?? {
      verified: false,
      note: "Not verified by model",
    };

    return {
      ...claim,
      verified: verification.verified,
      note: verification.note,
    };
  });

  const criticalMismatches = mergedClaims.filter(
    (c) => !c.verified && c.severity === "high",
  ).length;

  return {
    claims: mergedClaims,
    overallMatch: criticalMismatches === 0,
    criticalMismatches,
    overallNotes: parsed.overallNotes ?? "",
  };
}
