/**
 * Format the LLM-visible messages + their aligned entry IDs into a table.
 * Preview reflects the PROCESSED content the LLM sees (cleared stubs, etc.).
 * Used by acm_map so the LLM can correlate what it sees with entry IDs.
 */

export interface EntryMapRow {
  id: string;       // first 8 chars of entry ID, or "—" if none (e.g. slide summary)
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
    const texts = content.filter((b: any) => b.type === "text").map((b: any) => b.text);
    if (texts.length) return texts.join(" ").slice(0, MAX_PREVIEW);
    return `[${content.map((b: any) => b.type).join(",")}]`.slice(0, MAX_PREVIEW);
  }

  return "";
}

export function buildEntryMap(messages: any[], entryIds: (string | null)[]): EntryMapRow[] {
  const rows: EntryMapRow[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as any;
    const id = entryIds[i];
    rows.push({
      id: id ? id.slice(0, SHORT_ID_LEN) : "—",
      role: m.role ?? "unknown",
      preview: extractPreview(m),
    });
  }

  return rows;
}
