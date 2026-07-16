/**
 * Ephemeral tool-result tier.
 *
 * Some tool results are single-use: the LLM reads them once within a turn to
 * decide a follow-up action (e.g. acm_map -> pick id -> acm_pin), after which
 * they are pure bloat. Unlike normal auto-clear, ephemeral results are cleared
 * at the NEXT turn boundary unconditionally (no size/recency gate), but survive
 * their own turn so the follow-up action can still read them.
 *
 * Flow:
 *   tool.execute() -> ephemeralPending.add(toolCallId)     // registered
 *   next turn boundary -> promoteEphemeral(pending, clearSet)  // -> stubbed
 */
export function promoteEphemeral(
  ephemeralPending: Set<string>,
  clearSet: Set<string>,
): number {
  let count = 0;
  for (const id of ephemeralPending) {
    clearSet.add(id);
    count++;
  }
  ephemeralPending.clear();
  return count;
}
