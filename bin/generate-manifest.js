#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";

function pascalCase(str) {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

function extractPropsFromVue(content) {
  const match = content.match(/defineProps[<(]([\s\S]*?)[)>]/);

  if (!match) {
    return [];
  }

  const block = match[1];
  const propNames = [];

  for (const m of block.matchAll(/['"]?(\w+)['"]?\s*[?:]/g)) {
    if (m[1] && !["type", "default", "required", "validator"].includes(m[1])) {
      propNames.push(m[1]);
    }
  }

  return [...new Set(propNames)];
}

async function scanComponents(srcDir) {
  const components = [];
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirPath = path.join(srcDir, entry.name);
    const vuePath = path.join(dirPath, "index.vue");
    const tsPath = path.join(dirPath, "index.ts");

    let entryFile = null;

    try {
      await fs.access(vuePath);
      entryFile = vuePath;
    } catch {
      try {
        await fs.access(tsPath);
        entryFile = tsPath;
      } catch {
        continue;
      }
    }

    const name = entry.name;
    const pascal = pascalCase(name);
    const aliases = [pascal, `${pascal}Component`];

    if (name.includes("-")) {
      aliases.push(
        name
          .split("-")
          .map((s) => pascalCase(s))
          .join(""),
      );
    }

    let props = [];

    if (entryFile.endsWith(".vue")) {
      try {
        const content = await fs.readFile(entryFile, "utf8");
        props = extractPropsFromVue(content);
      } catch {
        // props extraction is best-effort
      }
    }

    components.push({
      name,
      path: path.relative(srcDir, entryFile),
      aliases: [...new Set(aliases)],
      props,
    });
  }

  return components.sort((a, b) => a.name.localeCompare(b.name));
}

const program = new Command()
  .name("generate-manifest")
  .description(
    "Generate a component manifest JSON from a Vue component directory.",
  )
  .requiredOption(
    "--src <path>",
    "Source directory containing component subdirectories",
  )
  .requiredOption("--out <path>", "Output path for the manifest JSON file")
  .action(async (options) => {
    const srcDir = path.resolve(options.src);
    const outPath = path.resolve(options.out);

    const components = await scanComponents(srcDir);

    const manifest = {
      generatedAt: new Date().toISOString(),
      sourceDir: srcDir,
      components,
    };

    await fs.writeFile(
      outPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.log(`Manifest: ${components.length} components → ${outPath}`);
  });

program.parseAsync(process.argv);
