/** Pure helper functions — no state, no side effects. */

export const STOP_WORDS = new Set([
  "this", "that", "with", "from", "have", "will", "been", "they", "then",
  "than", "when", "what", "which", "would", "should", "could", "also",
  "just", "like", "into", "each", "make", "here", "need", "some",
]);

export function extractKeywords(text: string, max = 25): string {
  const words = text.replace(/[^a-zA-Z0-9_./\-]/g, " ").split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const word of words) {
    if (word.length < 4 || STOP_WORDS.has(word.toLowerCase()) || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    keywords.push(word);
    if (keywords.length >= max) break;
  }
  return keywords.join(", ");
}

export function getBranchMessages(branch: any[]): any[] {
  return branch
    .filter((e: any) => e.type === "message" && e.message)
    .map((e: any) => e.message);
}

export function getTextPreview(msg: any, maxLen = 500): string {
  if (!Array.isArray(msg.content)) return "";
  for (const block of msg.content) {
    if (block.type === "text" && block.text) return block.text.slice(0, maxLen);
    if (block.type === "image") return "[image]";
  }
  return "";
}

export function extractEntryContent(entry: any): string {
  const c = entry?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((b: any) => b.type === "text" ? b.text : b.type === "image" ? "[image]" : JSON.stringify(b)).join("\n");
  }
  return JSON.stringify(entry);
}

export function compactMessage(msg: any, entryId: string): { content: any[]; saved: number } | null {
  if (!Array.isArray(msg.content)) return null;

  let totalChars = 0;
  let textContent = "";
  const hasToolCalls = msg.content.some((b: any) => b.type === "toolCall");

  for (const block of msg.content) {
    if (block.type === "text") { totalChars += block.text?.length || 0; textContent += block.text + " "; }
    else if (block.type === "thinking") totalChars += block.thinking?.length || 0;
  }

  if (totalChars < 1000) return null;

  const stub = `[compacted: ${extractKeywords(textContent)} | id: ${entryId}]`;

  if (hasToolCalls) {
    let stubInserted = false;
    const newContent: any[] = [];
    for (const block of msg.content) {
      if (block.type === "text" || block.type === "thinking") {
        if (!stubInserted) {
          newContent.push({ type: "text", text: stub });
          stubInserted = true;
        }
      } else {
        newContent.push(block);
      }
    }
    return { content: newContent, saved: totalChars - stub.length };
  }

  return { content: [{ type: "text", text: stub }], saved: totalChars - stub.length };
}

export function findHybridCutoff(branch: any[], opts?: { keepMessages?: number; keepMinutes?: number }): number {
  const keepMessages = opts?.keepMessages;
  const keepMinutes = opts?.keepMinutes;

  // Default: keepMinutes=30 if neither specified
  const effectiveMinutes = (keepMessages == null && keepMinutes == null) ? 30 : keepMinutes;
  const effectiveMessages = (keepMessages == null && keepMinutes == null) ? 10 : keepMessages;

  // Find effective start: last compaction's firstKeptEntryId
  // getBranch() returns full tree path including pre-compaction entries.
  // buildSessionContext() skips those, so we must too.
  let effectiveStart = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      const fk = branch[i].firstKeptEntryId;
      if (fk) {
        // Find the firstKeptEntry index
        for (let j = 0; j < branch.length; j++) {
          if (branch[j].id === fk) { effectiveStart = j; break; }
        }
      } else {
        // No firstKeptEntryId — start after compaction
        effectiveStart = i + 1;
      }
      break;
    }
  }

  const now = Date.now();

  // Time-based cutoff: first entry to KEEP (everything before gets slid)
  let timeCutoff = 0;
  if (effectiveMinutes != null) {
    const windowMs = effectiveMinutes * 60 * 1000;
    for (let i = branch.length - 1; i >= effectiveStart; i--) {
      const ts = branch[i].timestamp;
      const t = typeof ts === "number" ? ts : typeof ts === "string" ? new Date(ts).getTime() : 0;
      if (now - t > windowMs) { timeCutoff = i + 1; break; }
    }
  }

  // Message-based cutoff: walk backwards counting user messages
  let msgCutoff = 0;
  if (effectiveMessages != null) {
    let userCount = 0;
    for (let i = branch.length - 1; i >= effectiveStart; i--) {
      const e = branch[i];
      if (e.type === "message" && e.message?.role === "user") {
        userCount++;
        if (userCount >= effectiveMessages) { msgCutoff = i; break; }
      }
    }
    // If not enough user messages, msgCutoff stays 0 (no message-based sliding)
  }

  // Intersection semantics: discard if outside BOTH windows.
  // Math.max = more aggressive = discards more = slides further.
  // When only one param specified, the other stays 0 (no constraint from that axis).
  let cutoff: number;
  if (timeCutoff > 0 && msgCutoff > 0) {
    cutoff = Math.max(timeCutoff, msgCutoff);
  } else {
    // One or both are 0 — use whichever is non-zero
    cutoff = Math.max(timeCutoff, msgCutoff);
  }

  // Never cut before effectiveStart (would re-slide already-compacted entries)
  if (cutoff <= effectiveStart || cutoff >= branch.length) return 0;

  // Snap to valid cut point (user/assistant message or compaction boundary)
  // Snap to user message boundary — cutting at assistant/toolResult would
  // leave orphaned tool_use blocks without matching tool_result, which
  // fails Anthropic API validation (tool_result.tool_use_id required).
  const validCuts: number[] = [];
  for (let i = effectiveStart; i < branch.length; i++) {
    const e = branch[i];
    if (e.type === "compaction" || e.type === "branch_summary" || e.type === "custom") {
      validCuts.push(i);
    } else if (e.type === "message" && e.message?.role === "user") {
      validCuts.push(i);
    }
  }
  if (validCuts.length === 0) return 0;

  // Prefer snapping backwards (before cutoff), but if nothing found, snap forward
  // to first valid user message after cutoff.
  const before = validCuts.filter((i) => i <= cutoff);
  const after = validCuts.filter((i) => i > cutoff);
  cutoff = before.length > 0 ? before[before.length - 1] : (after.length > 0 ? after[0] : validCuts[0]);

  return cutoff;
}

/**
 * Select tool-result branch entries eligible for clearing.
 *
 * Pure decision predicate shared by the turn-boundary auto-clear hook and
 * acm_slide (so a slide can flush pending clears before reporting context %).
 *
 * An entry is clearable when it is a toolResult message with a toolCallId that
 * is not already cleared, whose entry id is not pinned, and whose toolCallId is
 * not in the protected (recent) set.
 */
export function selectClearableToolResults(
  entries: any[],
  opts: { pinnedSet: Set<string>; clearedSet: Set<string>; protectedToolCallIds: Set<string> },
): string[] {
  const { pinnedSet, clearedSet, protectedToolCallIds } = opts;
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry || entry.type !== "message" || !entry.message) continue;
    const msg = entry.message as any;
    if (msg.role !== "toolResult" || !msg.toolCallId) continue;
    if (clearedSet.has(msg.toolCallId)) continue;
    if (entry.id && pinnedSet.has(entry.id)) continue;
    if (protectedToolCallIds.has(msg.toolCallId)) continue;
    out.push(msg.toolCallId);
  }
  return out;
}
