import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

export default function contextDump(pi: ExtensionAPI) {
  pi.on("context", (event) => {
    const msgs = event.messages;
    const dump = {
      timestamp: new Date().toISOString(),
      messageCount: msgs.length,
      messageSizes: msgs.map((m: any, i: number) => ({
        index: i,
        role: m.role,
        bytes: JSON.stringify(m.content ?? "").length,
        preview: JSON.stringify(m.content ?? "").slice(0, 120),
      })),
      totalBytes: msgs.reduce((sum: number, m: any) => sum + JSON.stringify(m ?? "").length, 0),
    };
    writeFileSync("/tmp/acm-last-context.json", JSON.stringify(dump, null, 2));
  });
}
