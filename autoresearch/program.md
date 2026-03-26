# Figma Brief Autoresearch

You are optimizing figma-brief's context extraction quality. The CLI extracts design context from Figma and produces a `brief.json` for coding agents. Your job is to maximize the quality of that brief so an agent can one-shot implement the design.

## Your Goal

Maximize COMPOSITE_SCORE. The harness scores each test design structurally (coverage, component matching, unique intent, source diversity) and averages across ALL test designs. You must improve the average — a change that helps one design but hurts another is not progress.

## What You Can Change

ONLY edit `lib/heuristics.js`. This is a single config object with ~60 knobs. Read the status comments in that file — knobs are marked ACTIVE, DORMANT, or INDIRECT.

Focus on ACTIVE knobs first:
- `layout.maxNodes` — controls how many nodes appear in the layout summary
- `textIntent.*` — controls freeform text detection (keywords, thresholds, node name patterns)
- `componentMatching.*` — controls how Figma instances match to codebase components

INDIRECT knobs (confidence, qualityWeights) affect scoring but not extraction. Tune these second.
DORMANT knobs (commentRelevance) have no effect because MCP doesn't expose comments.

## What You CANNOT Change

- `lib/verifier.js`, `lib/quality-score.js`, `bin/autoresearch.js`
- `autoresearch/fixtures/`, `autoresearch/cache/`
- Test files, any file other than `lib/heuristics.js`

## The Loop

```
LOOP FOREVER:
  1. Read autoresearch/results.tsv — understand what's been tried
  2. Read lib/heuristics.js — the current knob state
  3. Hypothesize ONE change and WHY it should help
  4. Edit lib/heuristics.js
  5. Run:  node bin/autoresearch.js > autoresearch/run.log 2>&1
  6. Read: grep "COMPOSITE_SCORE\|INCUMBENT\|VERDICT\|FAILED\|error" autoresearch/run.log
  7. JUDGE STEP (required): For each design, read autoresearch/judge-<design>.md.
     Then read the brief at the path shown. Score 1-10 honestly.
     Write: echo <SCORE> > autoresearch/judge-score-<design>.txt
     Re-run: node bin/autoresearch.js > autoresearch/run.log 2>&1
     The composite now includes your judge score (40% structural + 60% judge).
  8. Read final: grep "COMPOSITE_SCORE\|INCUMBENT\|VERDICT" autoresearch/run.log
  9. If VERDICT=improved → git add lib/heuristics.js && git commit -m "autoresearch: <description>"
  10. If VERDICT=no_improvement → git checkout -- lib/heuristics.js
  11. Go to 1
```

IMPORTANT:
- NEVER use `--verbose` — it floods your context.
- ALWAYS redirect output to `autoresearch/run.log` and grep for the metric.
- The JUDGE STEP is mandatory. You ARE the quality judge. Be honest — would you one-shot this?
- ALWAYS re-evaluate and update judge scores after each heuristic change. Stale scores carry forward and corrupt the composite.
- If you want to inspect the full brief, read `.artifacts/autoresearch/*/brief.json`.
- One change per iteration. Don't batch hypotheses.

## Crash Handling

If the run prints `FAILED`:
1. Read `autoresearch/run.log` (last 30 lines only: `tail -30 autoresearch/run.log`)
2. If it's a **syntax error in heuristics.js** → revert: `git checkout -- lib/heuristics.js`, try a different change
3. If it's an **MCP connection error** → Figma app may be closed. Wait 10 seconds and retry once. If it fails again, stop and report.
4. If the **same hypothesis crashes twice** → discard it, log it mentally, move on
5. NEVER leave heuristics.js in a broken state between iterations

## Strategy Guidance

Current baseline: COMPOSITE_SCORE=0.240 (structural only, no judge scores yet).

Bottlenecks:
- **Coverage**: Desktop has 619 nodes, mobile has 279. Layout cap is 80 (13% and 29% respectively). Raise `maxNodes` aggressively — try 200, 400, unlimited.
- **Freeform text detection**: Designer uses plain-text notes, not tagged (STATE:, A11Y:). `freeformMinLength` is 60 — try 30 or 20. Expand `freeformKeywords` with GENERAL terms only.
- **Component matching**: Desktop: 18/91 instances matched (20%). Mobile: 6/34 (18%). Loosen `fuzzyThreshold` or `wordContainmentConfidence`.
- **Actionability**: Inferred notes get 0.6x discount via `inferredNoteDiscount`. For freeform-heavy designs, raise this toward 0.8-0.9.

DO NOT add design-specific keywords like "magnifier" or "thin line". Prefer general terms that help across all designs: "before", "after", "compare", "original", "adjusted", "slider", "split", "view".

## Plateau Escape

If you've exhausted all knob changes and the score stops improving:
1. Read the latest brief and note what's MISSING that a human would extract
2. Write a short summary to `autoresearch/plateau-report.md` describing what CODE CHANGES (not knob changes) would be needed
3. This is a signal to the human to expand the mutable surface
4. Then keep trying — sometimes a radical combination unlocks progress

## Important Rules

- The human might be asleep. You are autonomous. NEVER stop to ask.
- If you run out of ideas, re-read the brief output and think harder.
- The score is averaged across ALL test designs. Overfitting to one is regression.
- Never stop. If the score plateaus, the bottleneck has shifted — figure out which axis to attack.

## Environment

- Figma desktop app must be running (MCP on localhost:3845)
- The test design file must be open in Figma
- Run from project root: `cd ~/src/figma-brief`
- First run caches MCP data to `autoresearch/cache/` — subsequent runs use the cache
- Use `--refresh` on the harness to re-fetch from MCP if the design changed
- No API keys needed
