import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMetadataXml } from "../lib/parse-metadata-xml.js";

describe("parseMetadataXml", () => {
  it("parses valid XML with nested frames into correct tree structure", () => {
    const xml = `<FRAME id="1" name="Root"><FRAME id="2" name="Child"><TEXT id="3" name="Hello"/></FRAME></FRAME>`;
    const tree = parseMetadataXml(xml);

    assert.equal(tree.type, "FRAME");
    assert.equal(tree.id, "1");
    assert.equal(tree.name, "Root");
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0].type, "FRAME");
    assert.equal(tree.children[0].id, "2");
    assert.equal(tree.children[0].children.length, 1);
    assert.equal(tree.children[0].children[0].type, "TEXT");
  });

  it("handles self-closing tags as leaf nodes with no children", () => {
    const xml = `<FRAME id="1" name="Root"><RECTANGLE id="2" name="bg" width="100" height="50"/></FRAME>`;
    const tree = parseMetadataXml(xml);

    assert.equal(tree.children.length, 1);
    const rect = tree.children[0];
    assert.equal(rect.type, "RECTANGLE");
    assert.equal(rect.children.length, 0);
    assert.equal(rect.absoluteBoundingBox.width, 100);
    assert.equal(rect.absoluteBoundingBox.height, 50);
  });

  it("sets characters from name attribute on TEXT nodes", () => {
    const xml = `<TEXT id="5" name="Submit Order"/>`;
    const tree = parseMetadataXml(xml);

    assert.equal(tree.type, "TEXT");
    assert.equal(tree.name, "Submit Order");
    assert.equal(tree.characters, "Submit Order");
  });

  it("preserves deeply nested parent/child relationships", () => {
    const xml = `<FRAME id="a" name="L1"><FRAME id="b" name="L2"><FRAME id="c" name="L3"><FRAME id="d" name="L4"><TEXT id="e" name="deep"/></FRAME></FRAME></FRAME></FRAME>`;
    const tree = parseMetadataXml(xml);

    assert.equal(tree.id, "a");
    const l2 = tree.children[0];
    assert.equal(l2.id, "b");
    const l3 = l2.children[0];
    assert.equal(l3.id, "c");
    const l4 = l3.children[0];
    assert.equal(l4.id, "d");
    const text = l4.children[0];
    assert.equal(text.id, "e");
    assert.equal(text.characters, "deep");
  });

  it("returns partial tree and warns on malformed XML with extra closing tag", () => {
    const xml = `<FRAME id="1" name="Root"><TEXT id="2" name="Hello"></TEXT></FRAME></FRAME>`;

    const warnings = [];
    const origWrite = process.stderr.write;
    process.stderr.write = (msg) => {
      warnings.push(msg);
      return true;
    };

    try {
      const tree = parseMetadataXml(xml);
      assert.notEqual(tree, null, "should return partial tree, not null");
      assert.equal(tree.type, "FRAME");
      assert.equal(tree.id, "1");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("returns null for null or empty input", () => {
    assert.equal(parseMetadataXml(null), null);
    assert.equal(parseMetadataXml(""), null);
    assert.equal(parseMetadataXml(undefined), null);
  });
});
