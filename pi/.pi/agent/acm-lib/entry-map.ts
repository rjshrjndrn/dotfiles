/**
 * Build a table of context messages with short IDs, roles, and content previews.
 * Only includes messages currently in LLM context (not slid-away ones).
 * Used by acm_map tool so LLM can discover entry IDs for pinning.
 */

export interface EntryMapRow {
  id: string;       // first 8 chars of entry ID
  role: string;
  preview: string;
}

const MAX_PREVIEW = 60;
const SHORT_ID_LEN = 8;

function extractPreview(message: any): string {
  const content = message?.content;
  if (!content) return "";

  if (typeof content === "string") {
    return content.slice(0, MAX_PREVIEW);
  }

  if (Array.isArray(content)) {
    const textBlock = content.find((b: any) => b.type === "text");
    if (textBlock?.text) return textBlock.text.slice(0, MAX_PREVIEW);
  }

  return "";
}

export function buildEntryMap(messages: any[], msgEntryId: Map<any, string>): EntryMapRow[] {
  const rows: EntryMapRow[] = [];

  for (const msg of messages) {
    const entryId = msgEntryId.get(msg);
    if (!entryId) continue;

    rows.push({
      id: entryId.slice(0, SHORT_ID_LEN),
      role: msg.role ?? "unknown",
      preview: extractPreview(msg),
    });
  }

  return rows;
}
