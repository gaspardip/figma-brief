import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "../lib/slugify.js";

test("slugify converts spaces and mixed case to lowercase kebab", () => {
  assert.equal(slugify("Checkout Summary"), "checkout-summary");
});

test("slugify strips non-alphanumeric characters", () => {
  assert.equal(slugify("Button / Primary (Large)"), "button-primary-large");
});

test("slugify handles unicode via NFKD normalization", () => {
  assert.equal(slugify("Ícone de Ação"), "icone-de-acao");
});

test("slugify collapses consecutive separators", () => {
  assert.equal(slugify("a---b___c   d"), "a-b-c-d");
});

test("slugify returns fallback for empty input", () => {
  assert.equal(slugify(""), "figma-node");
  assert.equal(slugify("   "), "figma-node");
  assert.equal(slugify("!!!"), "figma-node");
});

test("slugify trims leading and trailing separators", () => {
  assert.equal(slugify("--hello--"), "hello");
});
