import fs from "node:fs/promises";
import path from "node:path";
import {
  buildCliProgram,
  normalizeBriefConfig,
  normalizeCompareConfig,
  normalizeScoreConfig,
} from "./config.js";
import { createLogger } from "./logger.js";
import { computeQualityScore } from "./quality-score.js";
import { generateFigmaBrief } from "./run.js";
import { formatScoreReport } from "./score-report.js";
import { formatValidationReport, validateBrief } from "./validate-brief.js";

export async function runCli({ argv, cwd, env }) {
  const program = buildCliProgram({ cwd, env });

  const briefCmd = program.commands.find((c) => c.name() === "brief");

  briefCmd.action(async (figmaUrl, options) => {
    const log = createLogger(program.opts().verbose);
    const config = normalizeBriefConfig({ cwd, figmaUrl, options });
    log("Brief config resolved", {
      figmaUrl: config.figmaUrl,
      format: config.format,
      outDir: config.outDir,
    });

    const result = await generateFigmaBrief(config, { log });

    console.log(`Wrote Figma brief to ${result.outputDir}`);
    console.log(`Confidence: ${result.brief.confidence.overall}`);
    console.log(`Quality: ${result.brief.quality.overall}`);

    // Auto-validate the generated brief
    const validation = await validateBrief(result.brief);
    console.log(formatValidationReport(validation));

    if (!validation.ready) {
      console.log(
        "Fix the issues above before feeding this brief to an implementing agent.",
      );
    }
  });

  const compareCmd = program.commands.find((c) => c.name() === "compare");

  compareCmd.action(async (options) => {
    const log = createLogger(program.opts().verbose);
    const config = normalizeCompareConfig({ cwd, env, options });
    log("Compare config resolved", {
      briefDir: config.briefDir,
      url: config.url,
      model: config.model,
    });

    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for the compare command.");
    }

    const { runCompare } = await import("./compare.js");
    const report = await runCompare(config, { log });

    const verified = report.claims.filter((c) => c.verified).length;
    const total = report.claims.length;
    const critical = report.claims.filter(
      (c) => !c.verified && c.severity === "high",
    );

    console.log(`Verification: ${verified}/${total} claims passed`);

    if (critical.length > 0) {
      console.log(`Critical mismatches (${critical.length}):`);

      for (const c of critical) {
        console.log(`  ✗ ${c.claim} — ${c.note}`);
      }

      process.exitCode = 1;
    }

    console.log(`Report: ${report.reportPath}`);
  });

  const scoreCmd = program.commands.find((c) => c.name() === "score");

  scoreCmd.action(async (options) => {
    const config = normalizeScoreConfig({ cwd, options });

    const briefPath = path.join(config.briefDir, "brief.json");
    const brief = JSON.parse(await fs.readFile(briefPath, "utf8"));
    const score = computeQualityScore(brief);

    let previousScore = null;

    if (config.compareTo) {
      const previousBrief = JSON.parse(
        await fs.readFile(config.compareTo, "utf8"),
      );
      previousScore =
        previousBrief.quality ?? computeQualityScore(previousBrief);
    }

    console.log(formatScoreReport(score, previousScore));
  });

  await program.parseAsync(argv, { from: "user" });
}
