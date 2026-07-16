/**
 * Context pipeline mutations that create NEW message objects.
 *
 * Entry-ID mapping is handled separately by position alignment
 * (see context-mapping.ts). These functions keep positions stable
 * (injectAcmContext replaces in place) or report what they prepend
 * (prependPinned returns the entry IDs it added, in message order).
 */

/**
 * Inject the acm-context block into the first user message.
 * Replaces the message object at the SAME index (position preserved).
 */
export function injectAcmContext(messages: any[], acmText: string): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as any;
    if (m.role !== "user") continue;

    messages[i] = {
      ...m,
      content: [
        { type: "text", text: acmText },
        ...(Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]),
      ],
    };
    return;
  }
}

/**
 * Prepend pinned content (survives slides) as synthetic user messages.
 * Returns the entry IDs of the prepended messages, in message order,
 * so the caller can keep a parallel entryIds[] aligned.
 */
export function prependPinned(
  messages: any[],
  pinnedContentStore: Map<string, { content: string; role?: string }>,
  pinnedSet: Set<string>,
  branch: any[],
): string[] {
  const pinnedMessages: any[] = [];
  const entryIds: string[] = [];

  for (const [entryId, entry] of pinnedContentStore) {
    // Skip if pin was removed
    if (!pinnedSet.has(entryId)) continue;
    // Skip if entry still exists in current branch (not yet slid)
    const alreadyInBranch = branch.some((e: any) => e.id === entryId);
    if (alreadyInBranch) continue;

    // Re-inject as "user" role — original tool_use context is gone after slide,
    // so a toolResult without toolCallId would fail API validation.
    pinnedMessages.push({
      role: "user",
      content: [{ type: "text", text: `[pinned:${entryId.slice(0, 8)}] ${entry.content}` }],
    });
    entryIds.push(entryId);
  }

  if (pinnedMessages.length > 0) {
    messages.unshift(...pinnedMessages);
  }
  return entryIds;
}
