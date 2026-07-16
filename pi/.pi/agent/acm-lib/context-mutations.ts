/**
 * Context pipeline mutations that create NEW message objects.
 *
 * Invariant: entry ID is immutable identity from JSONL. When a message
 * object is replaced or synthesized, its entry ID must transfer to the
 * new object ref so acm_map / acm_pin can still resolve it.
 */

/**
 * Inject the acm-context block into the first user message.
 * Replaces the message object (spread) — transfers entry ID to the new ref.
 */
export function injectAcmContext(
  messages: any[],
  msgEntryId: Map<any, string>,
  acmText: string,
): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as any;
    if (m.role !== "user") continue;

    const oldId = msgEntryId.get(m);
    messages[i] = {
      ...m,
      content: [
        { type: "text", text: acmText },
        ...(Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]),
      ],
    };
    // Transfer entry ID to the new object ref
    if (oldId) msgEntryId.set(messages[i], oldId);
    return;
  }
}

/**
 * Prepend pinned content (survives slides) as synthetic user messages.
 * Each synthetic message is mapped to its original entry ID.
 */
export function prependPinned(
  messages: any[],
  msgEntryId: Map<any, string>,
  pinnedContentStore: Map<string, { content: string; role?: string }>,
  pinnedSet: Set<string>,
  branch: any[],
): void {
  const pinnedMessages: any[] = [];

  for (const [entryId, entry] of pinnedContentStore) {
    // Skip if pin was removed
    if (!pinnedSet.has(entryId)) continue;
    // Skip if entry still exists in current branch (not yet slid)
    const alreadyInBranch = branch.some((e: any) => e.id === entryId);
    if (alreadyInBranch) continue;

    // Re-inject as "user" role — original tool_use context is gone after slide,
    // so a toolResult without toolCallId would fail API validation.
    const synthetic = {
      role: "user",
      content: [{ type: "text", text: `[pinned:${entryId.slice(0, 8)}] ${entry.content}` }],
    };
    pinnedMessages.push(synthetic);
    // Map synthetic message to its entry ID
    msgEntryId.set(synthetic, entryId);
  }

  if (pinnedMessages.length > 0) {
    messages.unshift(...pinnedMessages);
  }
}
