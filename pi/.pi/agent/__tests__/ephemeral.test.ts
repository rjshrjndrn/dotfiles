import { describe, it, expect } from "vitest";
import { promoteEphemeral } from "../acm-lib/ephemeral.ts";

describe("promoteEphemeral", () => {
  it("moves all pending ids into clearSet at a turn boundary", () => {
    const pending = new Set<string>(["tc-map-1", "tc-map-2"]);
    const clearSet = new Set<string>();

    promoteEphemeral(pending, clearSet);

    expect(clearSet.has("tc-map-1")).toBe(true);
    expect(clearSet.has("tc-map-2")).toBe(true);
  });

  it("empties pending after promotion (each id promoted once)", () => {
    const pending = new Set<string>(["tc-map-1"]);
    const clearSet = new Set<string>();

    promoteEphemeral(pending, clearSet);

    expect(pending.size).toBe(0);
  });

  it("preserves ids already in clearSet (union, no loss)", () => {
    const pending = new Set<string>(["tc-map-2"]);
    const clearSet = new Set<string>(["tc-old-1"]);

    promoteEphemeral(pending, clearSet);

    expect([...clearSet].sort()).toEqual(["tc-map-2", "tc-old-1"]);
  });

  it("returns the number of ids promoted", () => {
    const pending = new Set<string>(["a", "b", "c"]);
    const clearSet = new Set<string>();

    expect(promoteEphemeral(pending, clearSet)).toBe(3);
  });

  it("no-op when nothing pending", () => {
    const pending = new Set<string>();
    const clearSet = new Set<string>(["x"]);

    expect(promoteEphemeral(pending, clearSet)).toBe(0);
    expect([...clearSet]).toEqual(["x"]);
  });
});
