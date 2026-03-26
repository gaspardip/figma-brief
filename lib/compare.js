import fs from "node:fs/promises";
import path from "node:path";
import { captureScreenshot } from "./screenshot.js";
import { verifyAgainstBrief } from "./visual-verify.js";

export async function runCompare(config, { log = () => {} } = {}) {
  const briefPath = path.join(config.briefDir, "brief.json");

  log("Loading brief from", briefPath);

  let brief;

  try {
    brief = JSON.parse(await fs.readFile(briefPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not load brief.json from ${config.briefDir}: ${error.message}`,
    );
  }

  const figmaScreenshotPath = path.join(config.briefDir, "screenshot.png");

  try {
    await fs.access(figmaScreenshotPath);
  } catch {
    throw new Error(`Figma screenshot not found at ${figmaScreenshotPath}`);
  }

  log("Capturing implementation screenshot", {
    url: config.url,
    viewport: config.viewport,
  });

  const implScreenshot = await captureScreenshot({
    url: config.url,
    viewport: config.viewport,
    waitMs: config.waitMs,
    outputPath: path.join(config.briefDir, "impl-screenshot.png"),
  });

  log("Implementation screenshot saved", { path: implScreenshot.path });

  const report = await verifyAgainstBrief({
    brief,
    figmaScreenshot: figmaScreenshotPath,
    implScreenshot: implScreenshot.buffer,
    model: config.model,
    apiKey: config.anthropicApiKey,
    log,
  });

  const reportPath = path.join(config.briefDir, "compare-report.json");
  await fs.writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  report.reportPath = reportPath;

  return report;
}
