/**
 * Resolve a partial entry ID prefix to a full branch entry.
 * Supports exact match and unique prefix matching (like git short SHA).
 */

export type ResolveResult =
  | { ok: true; entry: any }
  | { ok: false; error: string; matches?: any[] };

export function resolveId(prefix: string, branch: any[]): ResolveResult {
  if (!prefix) {
    return { ok: false, error: "Empty entry ID" };
  }

  // Try exact match first
  const exact = branch.find((e) => e.id === prefix);
  if (exact) return { ok: true, entry: exact };

  // Prefix match
  const matches = branch.filter((e) => e.id.startsWith(prefix));

  if (matches.length === 0) {
    return { ok: false, error: `Entry ${prefix} not found on branch` };
  }
  if (matches.length === 1) {
    return { ok: true, entry: matches[0] };
  }

  return {
    ok: false,
    error: `Prefix "${prefix}" is ambiguous (${matches.length} matches). Use more characters.`,
    matches,
  };
}
