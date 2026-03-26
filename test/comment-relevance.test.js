import assert from "node:assert/strict";
import test from "node:test";
import { rankRelevantComments } from "../lib/comment-relevance.js";

const targetNode = {
  id: "10:1",
  name: "Card",
  absoluteBoundingBox: { x: 100, y: 100, width: 300, height: 200 },
};

const relevantNodeIds = new Set(["10:1", "10:2", "10:3"]);

function makeComment({ id, message, nodeId, point, resolved } = {}) {
  return {
    id: id ?? "c1",
    message: message ?? "some comment",
    created_at: "2026-03-19T10:00:00Z",
    resolved_at: resolved ? "2026-03-19T12:00:00Z" : null,
    client_meta: {
      node_id: nodeId ?? null,
      ...(point ? { x: point.x, y: point.y } : {}),
    },
    user: { handle: "designer" },
  };
}

test("ranks comments pinned on a relevant node highest", () => {
  const comments = [
    makeComment({ id: "c1", message: "Use the compact card", nodeId: "10:2" }),
    makeComment({ id: "c2", message: "Use the compact card", nodeId: "99:1" }),
  ];

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    threshold: 0,
  });

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, "c1");
  assert.ok(ranked[0].confidence > ranked[1].confidence);
});

test("boosts comments with tagged text (STATE:, A11Y:, etc.)", () => {
  const comments = [
    makeComment({
      id: "c1",
      message: "STATE: hover darkens background",
      nodeId: null,
    }),
    makeComment({ id: "c2", message: "nice work", nodeId: null }),
  ];

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    threshold: 0,
  });

  const tagged = ranked.find((c) => c.id === "c1");
  const generic = ranked.find((c) => c.id === "c2");

  assert.ok(tagged.confidence > generic.confidence);
});

test("penalizes resolved comments", () => {
  const comments = [
    makeComment({ id: "c1", message: "Use hover variant", resolved: false }),
    makeComment({ id: "c2", message: "Use hover variant", resolved: true }),
  ];

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    threshold: 0,
  });

  const open = ranked.find((c) => c.id === "c1");
  const resolved = ranked.find((c) => c.id === "c2");

  assert.ok(open.confidence > resolved.confidence);
});

test("scores comments inside target bounding box", () => {
  const comments = [
    makeComment({ id: "c1", message: "align this", point: { x: 150, y: 150 } }),
    makeComment({ id: "c2", message: "align this", point: { x: 900, y: 900 } }),
  ];

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    threshold: 0,
  });

  const inside = ranked.find((c) => c.id === "c1");
  const outside = ranked.find((c) => c.id === "c2");

  assert.ok(inside.confidence > outside.confidence);
});

test("respects maxComments limit", () => {
  const comments = Array.from({ length: 10 }, (_, i) =>
    makeComment({
      id: `c${i}`,
      message: "Use the hover variant",
      nodeId: "10:1",
    }),
  );

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    maxComments: 3,
  });

  assert.equal(ranked.length, 3);
});

test("filters out comments below threshold", () => {
  const comments = [makeComment({ id: "c1", message: "ok", nodeId: null })];

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    threshold: 0.9,
  });

  assert.equal(ranked.length, 0);
});

test("filters out empty comment text", () => {
  const comments = [makeComment({ id: "c1", message: "", nodeId: "10:1" })];

  const ranked = rankRelevantComments(comments, targetNode, relevantNodeIds, {
    threshold: 0,
  });

  assert.equal(ranked.length, 0);
});
