/**
 * Better @ fuzzy search — wraps pi's autocomplete provider to use
 * fzf --filter for @ file selection instead of pi's substring scoring.
 *
 * Uses find for file discovery, fzf for fuzzy ranking.
 */

import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type AutocompleteProvider, type AutocompleteItem } from "@mariozechner/pi-tui";
import { execSync } from "node:child_process";
import { basename } from "node:path";

const FZF_PATH = "/Users/skynet/.local/share/mise/installs/fzf/0.70.0/fzf";

function findAtPrefix(text: string): string | null {
	for (let i = text.length - 1; i >= 0; i--) {
		if (text[i] === "@") {
			if (i === 0 || /[\s\t"'=]/.test(text[i - 1]!)) {
				return text.slice(i);
			}
			return null;
		}
		if (/[\s\t]/.test(text[i]!)) return null;
	}
	return null;
}

function fzfFuzzyFiles(query: string, cwd: string): AutocompleteItem[] {
	try {
		const cmd = `find . -not -path '*/.git/*' -not -path '*/node_modules/*' \\( -type f -o -type d \\) | sed 's|^\\./||' | "${FZF_PATH}" --filter="${query.replace(/"/g, '\\"')}"`;
		const output = execSync(cmd, {
			encoding: "utf-8",
			cwd,
			shell: "/bin/bash",
			maxBuffer: 10 * 1024 * 1024,
			timeout: 5000,
		}).trim();

		if (!output) return [];

		return output
			.split("\n")
			.filter(Boolean)
			.slice(0, 20)
			.map((p) => {
				const isDir = p.endsWith("/");
				const name = basename(isDir ? p.slice(0, -1) : p);
				const displayPath = p.replace(/\\/g, "/");
				return {
					value: `@${displayPath}`,
					label: name + (isDir ? "/" : ""),
					description: displayPath,
				};
			});
	} catch {
		return [];
	}
}

class FuzzyAtProvider implements AutocompleteProvider {
	constructor(
		private original: AutocompleteProvider,
		private cwd: string
	) {}

	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number
	): { items: AutocompleteItem[]; prefix: string } | null {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		const atPrefix = findAtPrefix(textBeforeCursor);

		if (atPrefix) {
			const query = atPrefix.slice(1);
			if (!query) {
				return this.original.getSuggestions(lines, cursorLine, cursorCol);
			}

			const items = fzfFuzzyFiles(query, this.cwd);
			if (items.length === 0) return null;

			return { items, prefix: atPrefix };
		}

		return this.original.getSuggestions(lines, cursorLine, cursorCol);
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string
	) {
		if (prefix.startsWith("@")) {
			const currentLine = lines[cursorLine] || "";
			const before = currentLine.slice(0, cursorCol - prefix.length);
			const after = currentLine.slice(cursorCol);
			const isDir = item.label.endsWith("/");
			const suffix = isDir ? "" : " ";
			const newLine = `${before}${item.value}${suffix}${after}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: before.length + item.value.length + suffix.length,
			};
		}

		return this.original.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
}

class FuzzyAtEditor extends CustomEditor {
	private wrappedProvider = false;

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		if (!this.wrappedProvider) {
			this.wrappedProvider = true;
			super.setAutocompleteProvider(new FuzzyAtProvider(provider, process.cwd()));
		} else {
			super.setAutocompleteProvider(provider);
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, kb) => new FuzzyAtEditor(tui, theme, kb));
	});
}
