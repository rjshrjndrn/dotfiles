import type { Plugin } from "@opencode-ai/plugin"

const CONTEXT_1M_BETA = "context-1m-2025-08-07"

// Models confirmed to support 1M context window via Anthropic beta header.
// Source: https://docs.anthropic.com/claude/docs/models-overview (2026-02-18)
// Covers current: opus-4-6, sonnet-4-6
// Covers legacy:  sonnet-4-5, sonnet-4 (20250514)
const SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-0",
]

export const plugin: Plugin = async () => ({
  "chat.params": async (input, output) => {
    if (input.model.providerID !== "anthropic") return
    if (!input.model.api.id.includes("claude")) return
    if (!SUPPORTED_MODELS.some((m) => input.model.api.id.includes(m))) return
    const existing = output.options.anthropicBeta ?? []
    if (existing.includes(CONTEXT_1M_BETA)) return
    output.options.anthropicBeta = [...existing, CONTEXT_1M_BETA]
  },
})

