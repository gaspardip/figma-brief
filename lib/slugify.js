export function slugify(input) {
  return (
    String(input)
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "figma-node"
  );
}
