<div align="center">

# rush-shimo-cli

**石墨文档 CLI & MCP Server — 在终端和 AI Agent 中读取石墨文档**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 快速开始

```bash
# 登录
npx rush-shimo-cli login --token <your-token>

# 浏览文件
npx rush-shimo-cli recent
npx rush-shimo-cli cat <file-id>

# 读取表格
npx rush-shimo-cli sheets <sheet-id>
npx rush-shimo-cli table <sheet-id>
```

## 特性

- **自动发现 Sheet** — `sheets` 命令自动提取表格中的 sheet 名称，无需猜测
- **智能读取表格** — 无需指定 range 即可读取所有 sheet，也可指定特定 sheet/range
- **Unix 管道友好** — 内容输出到 stdout，状态信息输出到 stderr；支持 `--format tsv|csv|json`
- **URL & ID 支持** — 同时接受 `https://shimo.zhenguanyu.com/sheets/xxx` 完整链接和裸 ID
- **分层超时 + 自动重试** — 按操作类型设置 10s/30s/60s 超时，5xx/网络错误自动重试
- **MCP Server** — 内置 stdio MCP Server，提供 10 个工具供 AI Agent 调用
- **极简依赖** — 使用原生 `fetch`（Node 22），仅依赖 commander + MCP SDK

## 安装

**要求:** Node.js >= 22.0.0

```bash
npx rush-shimo-cli <command>           # 通过 npx 直接使用
npm install -g rush-shimo-cli          # 或全局安装
```

## 认证

获取石墨 Token：

1. 如果有 `shimo-user-id`，可通过 OAuth 获取 token（联系管理员）
2. 或直接使用已有的长期 token

然后配置：

```bash
# 方式 1: login 命令（保存到 ~/.shimo/config.json）
rush-shimo-cli login --token <your-token>

# 方式 2: 环境变量
export SHIMO_TOKEN=<your-token>
```

## 命令

| 命令 | 说明 |
|------|------|
| `login --token <t>` | 配置认证信息 |
| `whoami` | 查看当前用户 |
| `ls [folder]` | 列出文件夹内容 |
| `recent` | 最近访问的文件 |
| `info <file>` | 查看文件元信息 |
| `cat <file>` | 读取文档纯文本 |
| `sheets <file>` | 列出表格中的 sheet 名称 |
| `table <file> [sheet] [range]` | 读取表格内容 |
| `history <file>` | 查看编辑历史 |
| `comments <file>` | 查看评论数量 |
| `mentions <file>` | 列出文件中的 @提及 |
| `mcp` | 启动 MCP stdio 服务 |

所有命令支持 `--json` 输出 JSON 格式。`<file>` 接受文件 ID 或完整石墨 URL。

## 使用示例

### 文档

```bash
rush-shimo-cli cat <file-id>            # 读取文档文本
rush-shimo-cli info <file-id>            # 文件元信息
rush-shimo-cli history <file-id>         # 编辑历史
```

### 表格

```bash
rush-shimo-cli sheets <sheet-id>          # 列出所有 sheet 名称
rush-shimo-cli table <sheet-id>            # 读取所有 sheet
rush-shimo-cli table <sheet-id> "Sheet 1" # 读取指定 sheet
rush-shimo-cli table <sheet-id> "Sheet 1" A1:C10  # 读取指定范围
```

### URL 支持

```bash
# 完整 URL 在任何命令中都可使用
rush-shimo-cli sheets "https://shimo.zhenguanyu.com/sheets/<sheet-id>"
rush-shimo-cli cat "https://shimo.zhenguanyu.com/docs/<file-id>"
```

### 管道

`cat` 和 `table` 输出到 stdout，可与任何 Unix 工具组合：

```bash
# 搜索文档内容
rush-shimo-cli cat <file-id> | grep "关键词"

# 导出表格为 CSV
rush-shimo-cli table <sheet-id> -f csv > data.csv

# 用 jq 提取列
rush-shimo-cli table <sheet-id> -f json | jq '.[0].values[][0]'

# 获取最近文件 ID
rush-shimo-cli recent --json | jq '.[].guid'

# 统计行数
rush-shimo-cli table <sheet-id> | wc -l
```

## MCP Server

内置 MCP Server，供 AI Agent 集成使用（Claude Code、Cursor、Rush 等）。

### 配置

添加到 MCP 配置：

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

| 工具 | 说明 |
|------|------|
| `shimo_whoami` | 当前用户信息 |
| `shimo_list_files` | 列出文件夹内容 |
| `shimo_recent_files` | 最近访问的文件 |
| `shimo_file_info` | 文件元信息 |
| `shimo_read_doc` | 读取文档纯文本 |
| `shimo_list_sheets` | 列出 sheet 名称 |
| `shimo_read_sheet` | 读取表格内容（自动识别 sheet，可选 range） |
| `shimo_edit_history` | 编辑历史 |
| `shimo_mentions` | @提及列表 |
| `shimo_comment_count` | 评论数量 |

## AI Agent Skill

通过 [reskill](https://github.com/kanyun-inc/reskill) 安装为 AI Agent 技能：

```bash
npx reskill install github:kanyun-inc/rush-shimo-cli/skills -a claude-code cursor -y
```

安装后 AI Agent 可自主浏览、读取石墨文档和表格。

## API 参考

rush-shimo-cli 封装了石墨 REST API：

| 命令 | API Endpoint | 认证方式 |
|------|-------------|---------|
| `whoami` | `GET /lizard-api/users/me` | Bearer |
| `ls` | `GET /lizard-api/files?folder=` | Bearer |
| `recent` | `GET /lizard-api/files/recent` | Bearer |
| `info` | `GET /lizard-api/files/{id}` | Bearer |
| `cat` | `GET /sdk/v2/collab-files/{id}/plain-text` | Bearer |
| `sheets` | `GET /lizard-api/files/{id}/content`（解析 `"B:xxx"` 提取 sheet 名） | Bearer |
| `table` | `GET /api/sas/files/{id}/sheets/values` | Raw token |
| `history` | `GET /sdk/v2/collab-files/{id}/doc-sidebar-info` | Bearer |
| `comments` | `GET /sdk/v2/collab-files/{id}/comment-count` | Bearer |
| `mentions` | `GET /sdk/v2/collab-files/{id}/mention-at-list` | Bearer |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SHIMO_TOKEN` | API token | — |
| `SHIMO_BASE_URL` | 服务地址 | `https://shimo.zhenguanyu.com` |
| `SHIMO_API_KEY` | API key | 内置默认值 |

## License

MIT
