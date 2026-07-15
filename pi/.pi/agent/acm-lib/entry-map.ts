/**
 * Build a table of branch entries with short IDs, roles, and content previews.
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

export function buildEntryMap(branch: any[]): EntryMapRow[] {
  const rows: EntryMapRow[] = [];

  for (const entry of branch) {
    if (entry.type !== "message" || !entry.message) continue;

    rows.push({
      id: entry.id.slice(0, SHORT_ID_LEN),
      role: entry.message.role,
      preview: extractPreview(entry.message),
    });
  }

  return rows;
}
