export function deduplicateTexts(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const normalized = (item.text ?? "").trim().toLowerCase().slice(0, 80);

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      unique.push(item);
    }
  }

  return unique;
}
