import assert from "node:assert/strict";
import test from "node:test";
import { extractIntentFromTextNodes } from "../lib/text-intent.js";

const rootNode = {
  id: "1:1",
  type: "FRAME",
  name: "Checkout Summary",
  children: [
    {
      id: "2:1",
      type: "TEXT",
      name: "Implementation note",
      characters: "STATE: Hover state darkens background",
    },
    {
      id: "2:2",
      type: "TEXT",
      name: "Visible copy",
      characters: "Pay now",
    },
    {
      id: "2:3",
      type: "TEXT",
      name: "spec note",
      characters: "Use the compact card treatment from the mobile variant.",
    },
  ],
};

test("extractIntentFromTextNodes keeps tagged text nodes as high-confidence intent", () => {
  const result = extractIntentFromTextNodes(rootNode, { strictTags: false });

  assert.equal(result.taggedTextNodes.length, 1);
  assert.equal(result.taggedTextNodes[0].kind, "STATE");
  assert.equal(result.inferredTextNotes.length, 1);
});

test("extractIntentFromTextNodes drops untagged notes in strict mode", () => {
  const result = extractIntentFromTextNodes(rootNode, { strictTags: true });

  assert.equal(result.taggedTextNodes.length, 1);
  assert.equal(result.inferredTextNotes.length, 0);
});

test("extractIntentFromTextNodes captures self-closing INSTANCE nodes with annotation names", () => {
  const nodeWithAnnotation = {
    id: "1:1",
    type: "FRAME",
    name: "Frame",
    children: [
      {
        id: "3:1",
        type: "INSTANCE",
        name: "annotation",
        children: [],
      },
      {
        id: "3:2",
        type: "INSTANCE",
        name: "Button / Primary",
        children: [],
      },
    ],
  };

  const result = extractIntentFromTextNodes(nodeWithAnnotation, {
    strictTags: false,
  });

  // "annotation" matches freeformNodeNames → should be captured
  assert.equal(result.inferredTextNotes.length, 1);
  assert.equal(result.inferredTextNotes[0].text, "annotation");

  // "Button / Primary" has no keyword or node-name match → should NOT be captured
});

test("extractIntentFromTextNodes captures text with freeform keywords", () => {
  const nodeWithKeywords = {
    id: "1:1",
    type: "FRAME",
    name: "Frame",
    children: [
      {
        id: "4:1",
        type: "TEXT",
        name: "label",
        characters: "On hover show tooltip",
      },
      { id: "4:2", type: "TEXT", name: "label", characters: "Submit" },
    ],
  };

  const result = extractIntentFromTextNodes(nodeWithKeywords, {
    strictTags: false,
  });

  // "On hover show tooltip" contains "hover" keyword → captured
  assert.equal(result.inferredTextNotes.length, 1);
  assert.match(result.inferredTextNotes[0].text, /hover/);
});

test("extractIntentFromTextNodes does NOT capture short text without keyword or node-name match", () => {
  const nodeWithUICopy = {
    id: "1:1",
    type: "FRAME",
    name: "Frame",
    children: [
      {
        id: "5:1",
        type: "TEXT",
        name: "heading",
        characters: "Welcome back to your dashboard!",
      },
      {
        id: "5:2",
        type: "TEXT",
        name: "body",
        characters: "Here are your recent projects and updates from the team.",
      },
    ],
  };

  const result = extractIntentFromTextNodes(nodeWithUICopy, {
    strictTags: false,
  });

  // "Welcome back..." (31 chars) has no keyword match → NOT captured
  // "Here are your recent..." (56 chars) has no keyword match → NOT captured
  assert.equal(
    result.inferredTextNotes.length,
    0,
    "normal UI copy should not be classified as freeform instructions",
  );
});

test("extractIntentFromTextNodes captures long text (80+ chars) even without keywords", () => {
  const nodeWithLongText = {
    id: "1:1",
    type: "FRAME",
    name: "Frame",
    children: [
      {
        id: "6:1",
        type: "TEXT",
        name: "paragraph",
        characters:
          "This is a very long piece of text that exceeds eighty characters and should be captured regardless of keywords.",
      },
    ],
  };

  const result = extractIntentFromTextNodes(nodeWithLongText, {
    strictTags: false,
  });

  assert.equal(result.inferredTextNotes.length, 1);
});
