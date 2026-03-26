import fs from "node:fs/promises";
import path from "node:path";

export async function captureScreenshot({
  url,
  viewport,
  waitMs = 2000,
  outputPath,
}) {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    });

    await page.goto(url, { waitUntil: "networkidle" });

    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const buffer = await page.screenshot({ path: outputPath, fullPage: false });

    return { path: outputPath, buffer };
  } finally {
    await browser.close();
  }
}
