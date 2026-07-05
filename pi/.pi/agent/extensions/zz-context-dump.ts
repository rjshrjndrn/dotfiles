import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

export default function contextDump(pi: ExtensionAPI) {
  if (process.env.PI_DUMP_MESSAGE !== "true") return;

  pi.on("context", (event) => {
    const msgs = event.messages;
    const dump = {
      timestamp: new Date().toISOString(),
      messageCount: msgs.length,
      firstMessageFull: JSON.stringify(msgs[0]?.content ?? ""),
      acmContextBlock: (() => {
        for (const m of msgs) {
          const c = Array.isArray(m.content) ? m.content : [];
          for (const b of c) {
            if (b.type === "text" && b.text?.includes("acm-context")) return b.text;
          }
        }
        return null;
      })(),
      totalBytes: msgs.reduce((sum: number, m: any) => sum + JSON.stringify(m ?? "").length, 0),
      messageSizes: msgs.map((m: any, i: number) => ({
        index: i,
        role: m.role,
        bytes: JSON.stringify(m.content ?? "").length,
        preview: JSON.stringify(m.content ?? "").slice(0, 120),
      })),
    };
    writeFileSync("/tmp/acm-last-context.json", JSON.stringify(dump, null, 2));
  });
}
