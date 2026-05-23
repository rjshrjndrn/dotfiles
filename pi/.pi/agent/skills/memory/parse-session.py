#!/usr/bin/env python3
"""Parse pi-agent or Claude Code JSONL session files into clean markdown transcripts.

Usage:
    python3 parse-session.py <session.jsonl> [--output <path>] [--format <pi|claude>] [--verbose]

Auto-detects format from first line. Outputs clean markdown with YAML frontmatter.
"""

import json
import sys
import argparse
import re
from datetime import datetime, timezone
from pathlib import Path


def detect_format(first_line: dict) -> str:
    """Detect session format from first JSONL entry."""
    if first_line.get("type") == "session" and "version" in first_line:
        return "pi"
    if first_line.get("type") == "permission-mode" or (
        first_line.get("type") == "user" and "message" in first_line
    ):
        return "claude"
    # Fallback heuristics
    if "sessionId" in first_line:
        return "claude"
    if "cwd" in first_line and "version" in first_line:
        return "pi"
    return "unknown"


def extract_text_content(content) -> str:
    """Extract text from message content (handles string or list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
                # Skip tool_use, tool_result, image, thinking blocks
            elif isinstance(block, str):
                texts.append(block)
        return "\n".join(texts)
    return ""


def strip_acm_noise(text: str) -> str:
    """Remove ACM status tags and other injected metadata from text."""
    # Remove <context-status .../> tags
    text = re.sub(r"<context-status[^>]*/>\s*", "", text)
    # Remove <pruned-manifest>...</pruned-manifest> blocks
    text = re.sub(r"<pruned-manifest>.*?</pruned-manifest>\s*", "", text, flags=re.DOTALL)
    # Remove other ACM artifacts
    text = re.sub(r"<acm-[^>]*>.*?</acm-[^>]*>\s*", "", text, flags=re.DOTALL)
    return text.strip()


def parse_pi_session(lines: list[dict]) -> dict:
    """Parse pi-agent JSONL format."""
    session_info = {}
    exchanges = []
    timestamps = []

    for entry in lines:
        etype = entry.get("type", "")

        if etype == "session":
            session_info["id"] = entry.get("id", "")
            session_info["timestamp"] = entry.get("timestamp", "")
            session_info["cwd"] = entry.get("cwd", "")

        elif etype == "session_info":
            session_info["name"] = entry.get("name", "")

        elif etype == "message":
            msg = entry.get("message", {})
            role = msg.get("role", "")
            content = msg.get("content", "")
            ts = entry.get("timestamp", "")

            if ts:
                timestamps.append(ts)

            text = extract_text_content(content)
            text = strip_acm_noise(text)

            if not text.strip():
                continue

            if role == "user":
                exchanges.append({"role": "human", "text": text, "timestamp": ts})
            elif role == "assistant":
                exchanges.append({"role": "assistant", "text": text, "timestamp": ts})

        # Skip: tool_call, tool_result, model_change, thinking_level_change,
        #        custom, custom_message, etc.

    return {
        "session": session_info,
        "exchanges": exchanges,
        "timestamps": timestamps,
    }


def parse_claude_session(lines: list[dict]) -> dict:
    """Parse Claude Code JSONL format."""
    session_info = {}
    exchanges = []
    timestamps = []

    for entry in lines:
        etype = entry.get("type", "")

        if etype == "permission-mode":
            session_info["id"] = entry.get("sessionId", "")

        elif etype == "attachment" and entry.get("cwd"):
            session_info["cwd"] = entry.get("cwd", "")
            if not session_info.get("timestamp"):
                session_info["timestamp"] = entry.get("timestamp", "")

        elif etype == "user":
            msg = entry.get("message", {})
            content = msg.get("content", "")
            ts = entry.get("timestamp", "")

            if ts:
                timestamps.append(ts)

            text = extract_text_content(content)
            text = strip_acm_noise(text)

            if not text.strip():
                continue

            exchanges.append({"role": "human", "text": text, "timestamp": ts})

        elif etype == "assistant":
            msg = entry.get("message", {})
            content = msg.get("content", [])
            ts = entry.get("timestamp", "")

            if ts:
                timestamps.append(ts)

            text = extract_text_content(content)
            text = strip_acm_noise(text)

            if not text.strip():
                continue

            exchanges.append({"role": "assistant", "text": text, "timestamp": ts})

        # Skip: tool_use, tool_result, system, hook_success, file-history-snapshot,
        #        mcp_instructions_delta, skill_listing, task_reminder, last-prompt, etc.

    if not session_info.get("timestamp") and timestamps:
        session_info["timestamp"] = timestamps[0]

    return {
        "session": session_info,
        "exchanges": exchanges,
        "timestamps": timestamps,
    }


def estimate_duration(timestamps: list[str]) -> str:
    """Estimate session duration from first/last timestamps."""
    if len(timestamps) < 2:
        return "unknown"
    try:
        times = []
        for ts in timestamps:
            # Handle both formats
            ts_clean = ts.replace("Z", "+00:00")
            times.append(datetime.fromisoformat(ts_clean))
        if not times:
            return "unknown"
        delta = max(times) - min(times)
        minutes = int(delta.total_seconds() / 60)
        if minutes < 1:
            return "<1 min"
        elif minutes < 60:
            return f"{minutes} min"
        else:
            hours = minutes // 60
            remaining = minutes % 60
            return f"{hours}h {remaining}m"
    except (ValueError, TypeError):
        return "unknown"


def derive_project_name(cwd: str) -> str:
    """Extract project name from cwd path."""
    if not cwd:
        return "unknown"
    return Path(cwd).name


def format_markdown(parsed: dict, verbose: bool = False) -> str:
    """Format parsed session data as clean markdown with YAML frontmatter."""
    session = parsed["session"]
    exchanges = parsed["exchanges"]
    timestamps = parsed["timestamps"]

    # Metadata
    ts = session.get("timestamp", "")
    try:
        ts_clean = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_clean)
        date_str = dt.strftime("%Y-%m-%d")
        time_str = dt.strftime("%H:%M")
    except (ValueError, TypeError):
        date_str = "unknown"
        time_str = ""

    session_id = session.get("id", "unknown")
    project = derive_project_name(session.get("cwd", ""))
    duration = estimate_duration(timestamps)
    name = session.get("name", "")
    word_count = sum(len(ex["text"].split()) for ex in exchanges)

    # Build markdown
    lines = []

    # YAML frontmatter
    lines.append("---")
    lines.append(f"title: \"Session: {name or project} ({date_str})\"")
    lines.append(f"date: {date_str}")
    lines.append(f"source_type: session")
    lines.append(f"session_id: {session_id}")
    lines.append(f"project: {project}")
    lines.append(f"duration: {duration}")
    lines.append(f"exchanges: {len(exchanges)}")
    lines.append(f"word_count: {word_count}")
    if session.get("cwd"):
        lines.append(f"cwd: {session['cwd']}")
    lines.append("---")
    lines.append("")

    # Title
    title = name or f"{project} session"
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"**Date**: {date_str} {time_str}  ")
    lines.append(f"**Duration**: {duration}  ")
    lines.append(f"**Project**: {project}  ")
    lines.append(f"**Exchanges**: {len(exchanges)}  ")
    lines.append(f"**Word count**: {word_count}")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Conversation
    lines.append("## Conversation")
    lines.append("")

    exchange_num = 0
    for ex in exchanges:
        role_label = "**Human**" if ex["role"] == "human" else "**Assistant**"

        if ex["role"] == "human":
            exchange_num += 1
            lines.append(f"### Exchange {exchange_num}")
            lines.append("")

        lines.append(f"{role_label}:")
        lines.append("")
        lines.append(ex["text"])
        lines.append("")

    return "\n".join(lines)


def generate_output_path(parsed: dict, output_dir: str = ".") -> str:
    """Generate output filename from session metadata."""
    session = parsed["session"]
    ts = session.get("timestamp", "")
    try:
        ts_clean = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_clean)
        date_str = dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        date_str = "unknown"

    project = derive_project_name(session.get("cwd", ""))
    name = session.get("name", "")

    if name:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", project.lower()).strip("-")

    filename = f"{date_str}-{slug}.md"
    return str(Path(output_dir) / filename)


def main():
    parser = argparse.ArgumentParser(description="Parse LLM session JSONL to markdown")
    parser.add_argument("session_file", help="Path to session JSONL file")
    parser.add_argument("--output", "-o", help="Output file path (default: auto-generated)")
    parser.add_argument(
        "--format",
        "-f",
        choices=["pi", "claude", "auto"],
        default="auto",
        help="Session format (default: auto-detect)",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Include tool outputs")
    parser.add_argument(
        "--stdout", action="store_true", help="Print to stdout instead of file"
    )
    parser.add_argument(
        "--stats", action="store_true", help="Print stats only, no conversion"
    )

    args = parser.parse_args()

    # Read JSONL
    session_path = Path(args.session_file)
    if not session_path.exists():
        print(f"Error: {session_path} not found", file=sys.stderr)
        sys.exit(1)

    lines = []
    with open(session_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                lines.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not lines:
        print("Error: no valid JSONL entries found", file=sys.stderr)
        sys.exit(1)

    # Detect format
    fmt = args.format
    if fmt == "auto":
        fmt = detect_format(lines[0])
        if fmt == "unknown":
            print("Error: could not detect session format. Use --format pi|claude", file=sys.stderr)
            sys.exit(1)

    # Parse
    if fmt == "pi":
        parsed = parse_pi_session(lines)
    else:
        parsed = parse_claude_session(lines)

    # Stats mode
    if args.stats:
        session = parsed["session"]
        exchanges = parsed["exchanges"]
        duration = estimate_duration(parsed["timestamps"])
        word_count = sum(len(ex["text"].split()) for ex in exchanges)
        human_count = sum(1 for ex in exchanges if ex["role"] == "human")
        assistant_count = sum(1 for ex in exchanges if ex["role"] == "assistant")

        print(f"Format: {fmt}")
        print(f"Session ID: {session.get('id', 'unknown')}")
        print(f"Date: {session.get('timestamp', 'unknown')}")
        print(f"Project: {derive_project_name(session.get('cwd', ''))}")
        print(f"Name: {session.get('name', '(unnamed)')}")
        print(f"Duration: {duration}")
        print(f"Human messages: {human_count}")
        print(f"Assistant messages: {assistant_count}")
        print(f"Total exchanges: {len(exchanges)}")
        print(f"Word count: {word_count}")
        sys.exit(0)

    # Format
    markdown = format_markdown(parsed, verbose=args.verbose)

    # Output
    if args.stdout:
        print(markdown)
    else:
        output_path = args.output or generate_output_path(parsed)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            f.write(markdown)
        print(f"Written: {output_path}")
        print(f"Exchanges: {len(parsed['exchanges'])}")
        print(f"Words: {sum(len(ex['text'].split()) for ex in parsed['exchanges'])}")


if __name__ == "__main__":
    main()
