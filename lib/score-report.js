const AXES = [
  "layoutCoverage",
  "actionability",
  "grounding",
  "sourceDiversity",
  "uniqueIntent",
];

function bar(value, width = 20) {
  const filled = Math.round(value * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatDelta(delta) {
  if (delta === null || delta === undefined) {
    return "";
  }

  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${delta.toFixed(3)})`;
}

export function formatScoreReport(score, previousScore) {
  const lines = ["Quality Score Report", "====================", ""];

  for (const axis of AXES) {
    const value = score[axis] ?? 0;
    const delta = previousScore ? value - (previousScore[axis] ?? 0) : null;
    lines.push(
      `  ${axis.padEnd(16)} ${bar(value)} ${value.toFixed(3)}${formatDelta(delta)}`,
    );
  }

  lines.push("");
  const overallDelta = previousScore
    ? score.overall - (previousScore.overall ?? 0)
    : null;
  lines.push(
    `  ${"overall".padEnd(16)} ${bar(score.overall)} ${score.overall.toFixed(3)}${formatDelta(overallDelta)}`,
  );

  return lines.join("\n");
}

export function diffScores(current, previous) {
  const diff = {};

  for (const axis of [...AXES, "overall"]) {
    diff[axis] = Number(
      ((current[axis] ?? 0) - (previous[axis] ?? 0)).toFixed(3),
    );
  }

  return diff;
}
