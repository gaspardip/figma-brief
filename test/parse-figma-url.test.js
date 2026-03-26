import assert from "node:assert/strict";
import test from "node:test";
import { parseFigmaUrl, toHyphenatedNodeId } from "../lib/parse-figma-url.js";

test("parseFigmaUrl extracts file key and node id from design URLs", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/FILE123/Checkout?node-id=12-345",
  );

  assert.equal(parsed.fileKey, "FILE123");
  assert.equal(parsed.nodeId, "12:345");
  assert.equal(parsed.rawNodeId, "12-345");
});

test("toHyphenatedNodeId converts API ids back to URL form", () => {
  assert.equal(toHyphenatedNodeId("12:345"), "12-345");
});

test("parseFigmaUrl handles URLs without node-id as page-level", () => {
  const parsed = parseFigmaUrl("https://www.figma.com/design/FILE123/Checkout");

  assert.equal(parsed.fileKey, "FILE123");
  assert.equal(parsed.nodeId, null);
  assert.equal(parsed.rawNodeId, null);
  assert.equal(parsed.isPageLevel, true);
});

test("parseFigmaUrl marks node-id=0-1 as page-level", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/FILE123/Checkout?node-id=0-1",
  );

  assert.equal(parsed.nodeId, "0:1");
  assert.equal(parsed.isPageLevel, true);
});

test("parseFigmaUrl marks specific node-id as non-page-level", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/FILE123/Checkout?node-id=12-345",
  );

  assert.equal(parsed.isPageLevel, false);
});
