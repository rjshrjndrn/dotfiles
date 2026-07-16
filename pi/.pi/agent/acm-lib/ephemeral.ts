/**
 * Ephemeral tool-result tier.
 *
 * Some tool results are single-use: the LLM reads them once within a turn to
 * decide a follow-up action (e.g. acm_map -> pick id -> acm_pin), after which
 * they are pure bloat. Ephemerality is declared per tool TYPE in
 * config.ephemeralTools (e.g. ["acm_map"]).
 *
 * The context handler scans the branch (persisted JSONL) at each turn boundary
 * and moves matching tool results into clearSet unconditionally (no size/
 * recency gate). Because the branch only contains a turn-N tool call from the
 * turn-N+1 boundary onward, results survive their OWN turn automatically and
 * are cleared at the next one — with no in-memory state to persist.
 */
/**
 * Declarative tier: scan messages for tool calls whose tool NAME is registered
 * ephemeral, return their toolCallIds. Ephemerality is a property of the tool
 * TYPE (e.g. acm_map is always ephemeral), so tool code stays clean — the
 * context handler collects + registers centrally.
 */
export function collectEphemeralToolCallIds(
  messages: any[],
  ephemeralToolNames: Set<string>,
): string[] {
  const ids: string[] = [];
  if (ephemeralToolNames.size === 0) return ids;

  for (const m of messages) {
    const content = m?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "toolCall" && block?.type !== "tool_use") continue;
      if (!ephemeralToolNames.has(block.name)) continue;
      const id = block.id ?? block.toolCallId;
      if (id) ids.push(id);
    }
  }
  return ids;
}


