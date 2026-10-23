import { describe, expect, test } from "bun:test";

import { canonicalJson, cardHash } from "../src/hash";

describe("canonical JSON hashing", () => {
  test("sorts nested object keys without changing array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, list: [3, 2, 1] })).toBe(
      '{"list":[3,2,1],"nested":{"a":1,"b":2},"z":1}',
    );
  });

  test("is stable across object key order", () => {
    const first = {
      card_id: "stable-card",
      decision: { side: "long", size_pct: 0.03 },
      sources: [{ kol: "alice", extract: { sentiment: "bull", urgency: 0.6 } }],
    };
    const reordered = {
      sources: [{ extract: { urgency: 0.6, sentiment: "bull" }, kol: "alice" }],
      decision: { size_pct: 0.03, side: "long" },
      card_id: "stable-card",
    };

    expect(cardHash(first)).toBe(cardHash(reordered));
  });

  test("returns a 32-byte hex hash", () => {
    expect(cardHash({ card_id: "hash-shape" })).toMatch(/^0x[0-9a-f]{64}$/);
  });
});