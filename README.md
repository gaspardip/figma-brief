# figma-brief

Local CLI that extracts structured implementation context from Figma designs via the local MCP server. Produces a normalized `brief.json` + `prompt.md` that coding agents can consume to one-shot implement a design.

## Requirements

- Figma desktop app running with the target design file open
- Node.js >= 20
- The Figma app exposes a local MCP server at `localhost:3845`

## Usage

```bash
node ./bin/figma-brief.js "<figma-url>"
```

Flags:

```bash
node ./bin/figma-brief.js "<figma-url>" \
  --format both \
  --out-dir ./.artifacts/figma-brief \
  --max-comments 20 \
  --include-variables \
  --include-code-connect \
  --strict-tags \
  --component-manifest ./manifest.json \
  --feature 0 \
  --mcp-url http://localhost:3845/mcp \
  --verbose
```

### Subcommands

**brief** (default) — Generate an implementation brief from a Figma URL.

**compare** — Compare an implementation screenshot against the brief:
```bash
node ./bin/figma-brief.js compare \
  --brief-dir .artifacts/figma-brief/feature-name \
  --url http://localhost:3000/feature \
  --viewport 1280x720
```
Requires `ANTHROPIC_API_KEY` for the LLM visual verification.

**score** — Display a quality score report for an existing brief:
```bash
node ./bin/figma-brief.js score --brief-dir .artifacts/figma-brief/feature-name
node ./bin/figma-brief.js score --brief-dir ./run2 --compare-to ./run1/brief.json
```

## Component manifest

Generate a manifest from your Vue component directory:
```bash
node ./bin/generate-manifest.js --src /path/to/your/components --out manifest.json
```

Pass it to the CLI to map Figma component instances to codebase components:
```bash
node ./bin/figma-brief.js "<figma-url>" --component-manifest manifest.json
```

## Multi-feature designs

When the URL points to a page root (`node-id=0-1`), the CLI detects top-level features and prompts for selection. Use `--feature <name-or-index>` for non-interactive use.

## Output

```
.artifacts/figma-brief/<feature>/
  brief.json       # Structured brief with quality scores
  prompt.md        # Agent-consumable prompt (slim brief embedded)
  screenshot.png   # Figma node screenshot via MCP
  raw-design-context.json
  raw-variables.json
  raw-metadata.json
```

## Autoresearch

Autonomous heuristic optimization loop (Karpathy-style):

```bash
# Cache MCP data (requires Figma desktop open with the file):
node bin/autoresearch.js --refresh

# Run an iteration (uses cached data):
node bin/autoresearch.js

# Target-specific cache refresh:
node bin/autoresearch.js --refresh=my-design
```

The autoresearch agent edits `lib/heuristics.js` (the single mutable surface), runs the harness, and keeps or reverts based on the composite score. See `autoresearch/program.md` for agent instructions.

## Environment variables

| Variable | Purpose |
|---|---|
| `FIGMA_MCP_URL` | Override MCP server URL (default: `http://localhost:3845/mcp`) |
| `ANTHROPIC_API_KEY` | Required for `compare` command and optional LLM judge |
| `FIGMA_BRIEF_MODEL` | Override model for verification (default: `claude-sonnet-4-6`) |
