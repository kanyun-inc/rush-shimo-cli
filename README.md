<div align="center">

# rush-shimo-cli

**石墨文档 CLI & MCP Server — read Shimo documents from terminal and AI agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## Quick Start

```bash
# Login
npx rush-shimo-cli login --token <your-token>

# Browse
npx rush-shimo-cli recent
npx rush-shimo-cli cat 3O8pG2x48mb8Ty8y

# Spreadsheet
npx rush-shimo-cli sheets kyY7v4WybdYXUYL9
npx rush-shimo-cli table kyY7v4WybdYXUYL9
```

## Features

- **Auto sheet discovery** — `sheets` command extracts sheet names automatically, no more guessing
- **Smart table reading** — read all sheets without specifying range, or target a specific sheet/range
- **Unix pipe friendly** — stdout for content, stderr for status; `--format tsv|csv|json`
- **URL & ID support** — accepts both `https://shimo.zhenguanyu.com/sheets/xxx` and bare file IDs
- **Tiered timeouts + retry** — 10s/30s/60s by operation type, auto-retry on 5xx/network errors
- **MCP Server** — built-in stdio MCP server with 10 tools for AI agent integration
- **Zero dependencies** — uses native `fetch` (Node 22), only commander + MCP SDK

## Installation

**Requirements:** Node.js >= 22.0.0

```bash
npx rush-shimo-cli <command>           # Use directly via npx
npm install -g rush-shimo-cli          # Or global install
```

## Authentication

Get your Shimo token:

1. If you have a `shimo-user-id`, the token can be obtained via OAuth (ask your admin)
2. Or use an existing long-lived token directly

Then configure:

```bash
# Option 1: login command (saved to ~/.shimo/config.json)
rush-shimo-cli login --token <your-token>

# Option 2: environment variable
export SHIMO_TOKEN=<your-token>
```

## Commands

| Command | Description |
|---------|-------------|
| `login --token <t>` | Configure credentials |
| `whoami` | Show current user |
| `ls [folder]` | List files in folder |
| `recent` | List recently accessed files |
| `info <file>` | Show file metadata |
| `cat <file>` | Read document plain text |
| `sheets <file>` | List sheet names in a spreadsheet |
| `table <file> [sheet] [range]` | Read spreadsheet content |
| `history <file>` | Show edit history |
| `comments <file>` | Show comment count |
| `mentions <file>` | List @mentions in file |
| `mcp` | Start MCP stdio server |

All commands accept `--json` for JSON output. `<file>` accepts a file ID or full Shimo URL.

## Usage Examples

### Documents

```bash
rush-shimo-cli cat 3O8pG2x48mb8Ty8y                     # Read document text
rush-shimo-cli info 3O8pG2x48mb8Ty8y                     # File metadata
rush-shimo-cli history 3O8pG2x48mb8Ty8y                   # Edit history
```

### Spreadsheets

```bash
rush-shimo-cli sheets kyY7v4WybdYXUYL9                   # List all sheet names
rush-shimo-cli table kyY7v4WybdYXUYL9                     # Read ALL sheets
rush-shimo-cli table kyY7v4WybdYXUYL9 "Sheet 1"          # Read specific sheet
rush-shimo-cli table kyY7v4WybdYXUYL9 "Sheet 1" A1:C10   # Read specific range
```

### URL Support

```bash
# Full URL works everywhere
rush-shimo-cli sheets "https://shimo.zhenguanyu.com/sheets/kyY7v4WybdYXUYL9/YlDoR/"
rush-shimo-cli cat "https://shimo.zhenguanyu.com/docs/3O8pG2x48mb8Ty8y"
```

### Pipes

`cat` and `table` output to stdout. Combine with any Unix tool:

```bash
# Search document content
rush-shimo-cli cat 3O8pG2x48mb8Ty8y | grep "关键词"

# Export spreadsheet to CSV
rush-shimo-cli table kyY7v4WybdYXUYL9 -f csv > data.csv

# Extract column with jq
rush-shimo-cli table kyY7v4WybdYXUYL9 -f json | jq '.[0].values[][0]'

# Recent file IDs
rush-shimo-cli recent --json | jq '.[].guid'

# Count rows
rush-shimo-cli table kyY7v4WybdYXUYL9 | wc -l
```

## MCP Server

Built-in MCP server for AI agent integration (Claude Code, Cursor, Rush, etc.).

### Configuration

Add to your MCP settings:

```json
{
  "mcpServers": {
    "shimo": {
      "command": "npx",
      "args": ["-y", "rush-shimo-cli", "mcp"],
      "env": {
        "SHIMO_TOKEN": "<your-token>"
      }
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `shimo_whoami` | Current user info |
| `shimo_list_files` | List files in folder |
| `shimo_recent_files` | Recently accessed files |
| `shimo_file_info` | File metadata |
| `shimo_read_doc` | Read document plain text |
| `shimo_list_sheets` | **List sheet names** (key improvement) |
| `shimo_read_sheet` | **Read sheet content** (auto sheet name, optional range) |
| `shimo_edit_history` | Edit history |
| `shimo_mentions` | @mention list |
| `shimo_comment_count` | Comment count |

### Why This MCP Is Better

The existing `tutor-wb-common` Shimo MCP has critical issues:

| Problem | Old MCP | rush-shimo-cli |
|---------|---------|----------------|
| SSE connection timeout (70s) | SSE transport fails | stdio transport, instant |
| Can't discover sheet names | Agent guesses 8 times, all fail | `shimo_list_sheets` solves it |
| Must provide range | Error if no range given | Auto-reads all content |
| 10s hard timeout | Large files always fail | 30s + auto retry |
| 5 tools, 2 APIs | Minimal coverage | 10 tools, 8+ APIs |

## API Reference

| Command | API Endpoint | Auth |
|---------|-------------|------|
| `whoami` | `GET /lizard-api/users/me` | Bearer |
| `ls` | `GET /lizard-api/files?folder=` | Bearer |
| `recent` | `GET /lizard-api/files/recent` | Bearer |
| `info` | `GET /lizard-api/files/{id}` | Bearer |
| `cat` | `GET /sdk/v2/collab-files/{id}/plain-text` | Bearer |
| `sheets` | `GET /lizard-api/files/{id}/content` (parse `"B:xxx"`) | Bearer |
| `table` | `GET /api/sas/files/{id}/sheets/values` | Raw token |
| `history` | `GET /sdk/v2/collab-files/{id}/doc-sidebar-info` | Bearer |
| `comments` | `GET /sdk/v2/collab-files/{id}/comment-count` | Bearer |
| `mentions` | `GET /sdk/v2/collab-files/{id}/mention-at-list` | Bearer |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SHIMO_TOKEN` | API token | — |
| `SHIMO_BASE_URL` | Server URL | `https://shimo.zhenguanyu.com` |
| `SHIMO_API_KEY` | API key | Built-in default |

## License

MIT
