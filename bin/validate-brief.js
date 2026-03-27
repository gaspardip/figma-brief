#!/usr/bin/env node

// Validates a generated brief is ready for one-shot implementation.
// Run after brief generation, before feeding to an implementing agent.
//
// Usage:
//   node bin/validate-brief.js <brief-dir>
//   node bin/validate-brief.js --brief-dir=<path>

import fs from "node:fs/promises";
import path from "node:path";
import {
  formatValidationReport,
  validateBrief,
} from "../lib/validate-brief.js";

const briefDir =
  process.argv[2] ??
  process.argv.find((a) => a.startsWith("--brief-dir="))?.split("=")[1];

if (!briefDir) {
  console.error("Usage: node bin/validate-brief.js <brief-dir>");
  process.exit(1);
}

try {
  const briefPath = path.resolve(briefDir, "brief.json");
  const brief = JSON.parse(await fs.readFile(briefPath, "utf8"));
  const result = await validateBrief(brief);

  console.log(formatValidationReport(result));

  if (!result.ready) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Failed to validate: ${error.message}`);
  process.exitCode = 1;
}
