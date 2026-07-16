/**
 * Map each LLM-visible message to its immutable JSONL entry ID.
 *
 * Object refs do NOT survive the SDK message rebuild, and timestamps collide
 * for parallel tool results. The reliable method is POSITION ALIGNMENT against
 * the branch, computed while entry IDs are known (verified live via cross-check
 * against tcEntryId — see acm.ts PROOF diagnostic).
 *
 * Must run AFTER slide (which rebuilds messages) and in-place mutations
 * (clear/compact/inject preserve positions), but BEFORE pinned prepend
 * (which shifts positions — handled separately by prependPinned's return).
 */

export interface ActiveSlide {
  cutoffEntryId: string;
  summary: string;
}

export function alignEntryIds(
  branch: any[],
  messages: any[],
  slide: ActiveSlide | null,
): (string | null)[] {
  const branchMsgs = branch.filter((e) => e.type === "message" && e.message);

  let ptr = 0;
  let start = 0;
  const ids: (string | null)[] = [];

  if (slide) {
    const cutoffIdx = branch.findIndex((e) => e.id === slide.cutoffEntryId);
    if (cutoffIdx > 0) {
      // messages[0] is the slide summary (synthetic, no single entry ID)
      ids.push(null);
      start = 1;
      // Skip branch message-entries before the cutoff
      ptr = branch.slice(0, cutoffIdx).filter((e) => e.type === "message" && e.message).length;
    }
    // cutoff not found (<=0): fall through to plain position alignment
  }

  for (let i = start; i < messages.length; i++) {
    const e = branchMsgs[ptr++];
    ids.push(e ? e.id : null);
  }

  return ids;
}
