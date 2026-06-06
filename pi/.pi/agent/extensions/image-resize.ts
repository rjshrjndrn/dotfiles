/**
 * Image Resize Extension
 *
 * Intercepts tool results containing images and resizes them to reduce
 * token usage. Pi's default is 2000x2000px; Anthropic's optimal tile
 * boundary is 1568px. This extension downsizes to a configurable max
 * dimension (default: 800px) and forces JPEG output by setting maxBytes
 * low enough that PNG candidates fail, leaving JPEG as the winner.
 *
 * Images inside tool_result blocks are invisible to headroom's image
 * compression (it only scans top-level message content), so this
 * extension catches what headroom misses.
 */

import type { ExtensionAPI, ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { resizeImage } from "@earendil-works/pi-coding-agent";
// Configurable via env: PI_IMAGE_MAX_DIM=768
const MAX_DIMENSION = parseInt(process.env.PI_IMAGE_MAX_DIM || "800", 10);
// Setting maxBytes below typical PNG base64 size forces JPEG output.
// resizeImage tries [PNG, JPEG@q1, JPEG@q2...] and picks first under maxBytes.
// 800px PNG ≈ 250-400KB base64, JPEG ≈ 70-120KB — so 200KB rejects PNG, accepts JPEG.
const MAX_BYTES = 200_000;
const JPEG_QUALITY = 70;

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, _ctx): Promise<ToolResultEventResult | void> => {
    const images = event.content.filter((c) => c.type === "image");
    if (images.length === 0) return;

    let modified = false;
    const newContent = await Promise.all(
      event.content.map(async (block) => {
        if (block.type !== "image") return block;

        try {
          const inputBytes = new Uint8Array(
            Buffer.from(block.data, "base64")
          );

          const resized = await resizeImage(inputBytes, block.mimeType, {
            maxWidth: MAX_DIMENSION,
            maxHeight: MAX_DIMENSION,
            maxBytes: MAX_BYTES,
            jpegQuality: JPEG_QUALITY,
          });

          if (!resized) {
            return block;
          }

          // Only replace if we actually reduced size
          const newSize = Buffer.byteLength(resized.data, "base64");
          const oldSize = Buffer.byteLength(block.data, "base64");

          if (newSize < oldSize * 0.9) {
            modified = true;
            return {
              type: "image" as const,
              data: resized.data,
              mimeType: resized.mimeType,
            };
          }

          return block;
        } catch (err) {
          return block;
        }
      })
    );

    if (modified) {
      return { content: newContent };
    }
  });
}
