import { Command } from 'commander';
import { registerCommands } from './commands.js';

const program = new Command();

program
  .name('rush-shimo-cli')
  .description('石墨文档 CLI — read Shimo documents from terminal and AI agents')
  .version('0.1.0');

registerCommands(program);

program
  .command('mcp')
  .description('Start MCP stdio server for AI agent integration')
  .action(async () => {
    const { startMcpServer } = await import('./mcp.js');
    await startMcpServer();
  });

program.parse();
