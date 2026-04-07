/**
 * CLI Commands
 *
 * stdout 只输出内容（可管道），stderr 输出状态信息。
 */

import type { Command } from 'commander';
import { ShimoClient } from './client.js';
import { getApiKey, getBaseUrl, getConfigPath, getToken, saveConfig } from './config.js';
import { extractFileId, extractFolderId } from './url.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient(): ShimoClient {
  const token = getToken();
  if (!token) {
    console.error(
      'Error: No token configured.\n' +
        'Run `rush-shimo-cli login --token <token>` or set SHIMO_TOKEN environment variable.',
    );
    process.exit(1);
  }
  return new ShimoClient(getBaseUrl(), token, getApiKey());
}

function resolveId(input: string): string {
  const id = extractFileId(input);
  if (!id) {
    console.error(`Error: 无法解析文件 ID: ${input}`);
    process.exit(1);
  }
  return id;
}

function resolveFolderIdOrExit(input: string): string {
  const id = extractFolderId(input);
  if (!id) {
    console.error(`Error: 无法解析目录 ID: ${input}`);
    process.exit(1);
  }
  return id;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleString('zh-CN', { hour12: false });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerCommands(program: Command): void {
  // --- login ---
  program
    .command('login')
    .description('Configure Shimo credentials')
    .option('-t, --token <token>', 'Shimo API token')
    .option('-u, --url <url>', 'Shimo server URL')
    .action(async (opts) => {
      const token = opts.token;
      if (!token) {
        console.error(
          'Error: --token is required.\n' +
            '获取方式：\n' +
            '  1. 通过 shimo-user-id + OAuth 获取 token\n' +
            '  2. 或直接使用已有的 shimo token',
        );
        process.exit(1);
      }
      const client = new ShimoClient(
        opts.url ?? getBaseUrl(),
        token,
        getApiKey(),
      );
      try {
        const user = await client.me();
        saveConfig(token, opts.url);
        console.log(`Logged in as ${user.name} (${user.email})`);
        console.log(`Config saved to ${getConfigPath()}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // --- whoami ---
  program
    .command('whoami')
    .description('Show current user')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const user = await client.me();
      if (opts.json) {
        process.stdout.write(JSON.stringify(user, null, 2) + '\n');
      } else {
        console.log(`${user.name} (${user.email})`);
        if (user.team) console.log(`Team: ${user.team.name}`);
      }
    });

  // --- ls ---
  program
    .command('ls')
    .description('List files in folder')
    .argument('[folder]', 'Folder ID or URL')
    .option('--json', 'Output as JSON')
    .action(async (folder: string | undefined, opts) => {
      const client = getClient();
      const folderId = folder ? resolveFolderIdOrExit(folder) : undefined;
      const files = await client.ls(folderId);
      if (opts.json) {
        process.stdout.write(JSON.stringify(files, null, 2) + '\n');
        return;
      }
      if (files.length === 0) {
        console.log('(empty)');
        return;
      }
      for (const f of files) {
        const icon = f.type === 'folder' ? '📁' : f.type === 'mosheet' ? '📊' : '📄';
        console.log(`${icon} ${f.name}\t${f.guid}\t${f.type}`);
      }
    });

  // --- recent ---
  program
    .command('recent')
    .description('List recently accessed files')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const client = getClient();
      const files = await client.recent();
      if (opts.json) {
        process.stdout.write(JSON.stringify(files, null, 2) + '\n');
        return;
      }
      for (const f of files) {
        const icon = f.type === 'mosheet' ? '📊' : '📄';
        console.log(`${icon} ${f.name}\t${f.guid}\t${formatDate(f.updatedAt)}`);
      }
    });

  // --- info ---
  program
    .command('info')
    .description('Show file metadata')
    .argument('<file>', 'File ID or URL')
    .option('--json', 'Output as JSON')
    .action(async (file: string, opts) => {
      const client = getClient();
      const fileId = resolveId(file);
      const info = await client.info(fileId);
      if (opts.json) {
        process.stdout.write(JSON.stringify(info, null, 2) + '\n');
        return;
      }
      console.log(`Name:    ${info.name}`);
      console.log(`ID:      ${info.guid}`);
      console.log(`Type:    ${info.type}`);
      console.log(`Created: ${formatDate(info.createdAt)}`);
      console.log(`Updated: ${formatDate(info.updatedAt)}`);
      if (info.user) {
        console.log(`Author:  ${info.user.name} (${info.user.email})`);
      }
    });

  // --- cat ---
  program
    .command('cat')
    .description('Read document plain text (stdout, pipe-friendly)')
    .argument('<file>', 'File ID or URL')
    .action(async (file: string) => {
      const client = getClient();
      const fileId = resolveId(file);
      const content = await client.cat(fileId);
      process.stdout.write(content);
    });

  // --- sheets ---
  program
    .command('sheets')
    .description('List sheet names in a spreadsheet')
    .argument('<file>', 'File ID or URL')
    .option('--json', 'Output as JSON')
    .action(async (file: string, opts) => {
      const client = getClient();
      const fileId = resolveId(file);
      const sheetList = await client.sheets(fileId);
      if (opts.json) {
        process.stdout.write(JSON.stringify(sheetList, null, 2) + '\n');
        return;
      }
      if (sheetList.length === 0) {
        console.log('(no sheets found)');
        return;
      }
      for (const s of sheetList) {
        console.log(`${s.index}\t${s.name}`);
      }
    });

  // --- table ---
  program
    .command('table')
    .description('Read spreadsheet content')
    .argument('<file>', 'File ID or URL')
    .argument('[sheet]', 'Sheet name (default: all sheets)')
    .argument('[range]', 'Cell range like A1:C10 (default: all)')
    .option('-f, --format <fmt>', 'Output format: tsv, csv, json', 'tsv')
    .action(async (file: string, sheet: string | undefined, range: string | undefined, opts) => {
      const client = getClient();
      const fileId = resolveId(file);
      const results = await client.catSheet(fileId, sheet, range);

      if (opts.format === 'json') {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n');
        return;
      }

      const sep = opts.format === 'csv' ? ',' : '\t';
      for (const s of results) {
        if (results.length > 1) {
          console.error(`--- ${s.name} ---`);
        }
        for (const row of s.values) {
          const line = row.map((cell) => {
            if (cell === null || cell === undefined) return '';
            const str = String(cell);
            if (opts.format === 'csv' && (str.includes(',') || str.includes('"') || str.includes('\n'))) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            if (opts.format === 'tsv' && str.includes('\t')) {
              return str.replace(/\t/g, ' ');
            }
            return str;
          });
          process.stdout.write(line.join(sep) + '\n');
        }
      }
    });

  // --- history ---
  program
    .command('history')
    .description('Show edit history')
    .argument('<file>', 'File ID or URL')
    .option('--json', 'Output as JSON')
    .option('-n, --limit <n>', 'Number of entries', '20')
    .action(async (file: string, opts) => {
      const client = getClient();
      const fileId = resolveId(file);
      const { histories } = await client.history(fileId, Number(opts.limit));
      if (opts.json) {
        process.stdout.write(JSON.stringify(histories, null, 2) + '\n');
        return;
      }
      if (histories.length === 0) {
        console.log('No history.');
        return;
      }
      for (const h of histories) {
        const type = h.historyType === 1 ? 'op' : 'edit';
        console.log(`[${type}] ${formatDate(h.createdAt)}  user:${h.userId}`);
      }
    });

  // --- comments ---
  program
    .command('comments')
    .description('Show comment count')
    .argument('<file>', 'File ID or URL')
    .action(async (file: string) => {
      const client = getClient();
      const fileId = resolveId(file);
      const count = await client.commentCount(fileId);
      console.log(`${count}`);
    });

  // --- mentions ---
  program
    .command('mentions')
    .description('List @mentions in file')
    .argument('<file>', 'File ID or URL')
    .option('--json', 'Output as JSON')
    .action(async (file: string, opts) => {
      const client = getClient();
      const fileId = resolveId(file);
      const list = await client.mentions(fileId);
      if (opts.json) {
        process.stdout.write(JSON.stringify(list, null, 2) + '\n');
        return;
      }
      if (list.length === 0) {
        console.log('No mentions.');
        return;
      }
      for (const m of list) {
        console.log(`user:${m.userId}\t${m.atGuid}`);
      }
    });
}
