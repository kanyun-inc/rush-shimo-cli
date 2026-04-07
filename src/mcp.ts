/**
 * Shimo MCP Server (stdio transport)
 *
 * Usage: rush-shimo-cli mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ShimoClient } from './client.js';
import { getApiKey, getBaseUrl, getToken } from './config.js';
import { resolveFileId } from './url.js';

function getClient(): ShimoClient {
  const token = getToken();
  if (!token) {
    throw new Error(
      'SHIMO_TOKEN not set. Run `rush-shimo-cli login --token <token>` or set the env var.',
    );
  }
  return new ShimoClient(getBaseUrl(), token, getApiKey());
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(err: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

const TOOLS = [
  {
    name: 'shimo_whoami',
    description: '获取当前石墨用户信息（姓名、邮箱、团队）',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'shimo_list_files',
    description: '列出石墨目录下的文件和文件夹',
    inputSchema: {
      type: 'object' as const,
      properties: {
        folderId: { type: 'string', description: '目录 ID（不传则列出桌面文件）' },
        folderUrl: { type: 'string', description: '目录 URL' },
      },
    },
  },
  {
    name: 'shimo_recent_files',
    description: '列出最近访问的石墨文件',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'shimo_file_info',
    description: '获取石墨文件的元信息（名称、类型、创建时间、作者等）',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨文件链接' },
        fileId: { type: 'string', description: '石墨文件 ID' },
      },
    },
  },
  {
    name: 'shimo_read_doc',
    description: '读取石墨文档的纯文本内容。适用于轻文档(newdoc/docs)和传统文档(docx)。不适用于表格，表格请用 shimo_read_sheet。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨文档链接' },
        fileId: { type: 'string', description: '石墨文档 ID' },
      },
    },
  },
  {
    name: 'shimo_list_sheets',
    description: '列出石墨表格中所有工作表(sheet)的名称。在读取表格内容前先调用此工具获取 sheet 名称列表。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨表格链接' },
        fileId: { type: 'string', description: '石墨表格 ID' },
      },
    },
  },
  {
    name: 'shimo_read_sheet',
    description:
      '读取石墨表格内容。不传 sheetName 时自动读取所有工作表；传 sheetName 可读指定工作表；传 range 可读指定范围（如 A1:C10）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨表格链接' },
        fileId: { type: 'string', description: '石墨表格 ID' },
        sheetName: {
          type: 'string',
          description: '工作表名称（不传则读取所有工作表）。可先用 shimo_list_sheets 获取名称列表。',
        },
        range: {
          type: 'string',
          description: '单元格范围，如 A1:C10（不传则读取整个工作表）',
        },
      },
    },
  },
  {
    name: 'shimo_edit_history',
    description: '获取石墨文件的编辑历史',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨文件链接' },
        fileId: { type: 'string', description: '石墨文件 ID' },
        limit: { type: 'number', description: '返回条数，默认 20' },
      },
    },
  },
  {
    name: 'shimo_mentions',
    description: '获取石墨文件中所有 @人 的列表',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨文件链接' },
        fileId: { type: 'string', description: '石墨文件 ID' },
      },
    },
  },
  {
    name: 'shimo_comment_count',
    description: '获取石墨文件中的评论总数',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fileUrl: { type: 'string', description: '石墨文件链接' },
        fileId: { type: 'string', description: '石墨文件 ID' },
      },
    },
  },
];

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'rush-shimo-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const client = getClient();

      switch (request.params.name) {
        case 'shimo_whoami': {
          const user = await client.me();
          return ok(
            `${user.name} (${user.email})${user.team ? `\nTeam: ${user.team.name}` : ''}`,
          );
        }

        case 'shimo_list_files': {
          const folderId = (args.folderId as string) || (args.folderUrl ? resolveFileId(args.folderUrl as string) : undefined);
          const files = await client.ls(folderId);
          if (files.length === 0) return ok('（空目录）');
          const lines = files.map((f) => {
            const icon = f.type === 'folder' ? '📁' : f.type === 'mosheet' ? '📊' : '📄';
            return `${icon} ${f.name} (${f.type}) id=${f.guid}`;
          });
          return ok(lines.join('\n'));
        }

        case 'shimo_recent_files': {
          const files = await client.recent();
          const lines = files.map((f) => {
            const icon = f.type === 'mosheet' ? '📊' : '📄';
            return `${icon} ${f.name} (${f.type}) id=${f.guid} updated=${f.updatedAt}`;
          });
          return ok(lines.join('\n'));
        }

        case 'shimo_file_info': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const info = await client.info(id);
          return ok(JSON.stringify(info, null, 2));
        }

        case 'shimo_read_doc': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const content = await client.cat(id);
          return ok(content);
        }

        case 'shimo_list_sheets': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const sheetList = await client.sheets(id);
          if (sheetList.length === 0) return ok('没有找到工作表');
          const lines = sheetList.map((s) => `${s.index}: ${s.name}`);
          return ok(`工作表列表:\n${lines.join('\n')}`);
        }

        case 'shimo_read_sheet': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const results = await client.catSheet(
            id,
            args.sheetName as string | undefined,
            args.range as string | undefined,
          );
          const output = results.map((s) => {
            const header = results.length > 1 ? `--- ${s.name} ---\n` : '';
            return header + JSON.stringify(s.values, null, 2);
          });
          return ok(output.join('\n\n'));
        }

        case 'shimo_edit_history': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const { histories } = await client.history(
            id,
            (args.limit as number) ?? 20,
          );
          if (histories.length === 0) return ok('没有编辑历史');
          const lines = histories.map((h) => {
            const type = h.historyType === 1 ? '操作' : '编辑';
            return `[${type}] ${h.createdAt} user:${h.userId}`;
          });
          return ok(lines.join('\n'));
        }

        case 'shimo_mentions': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const list = await client.mentions(id);
          if (list.length === 0) return ok('没有 @提及');
          const lines = list.map((m) => `user:${m.userId} at:${m.atGuid}`);
          return ok(lines.join('\n'));
        }

        case 'shimo_comment_count': {
          const id = resolveFileId(args.fileUrl as string, args.fileId as string);
          const count = await client.commentCount(id);
          return ok(`评论数: ${count}`);
        }

        default:
          return fail(`Unknown tool: ${request.params.name}`);
      }
    } catch (err) {
      return fail(err);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
