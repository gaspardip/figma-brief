#!/usr/bin/env node

import { runCli } from "../lib/cli.js";

runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
