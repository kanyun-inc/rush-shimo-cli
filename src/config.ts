/**
 * 配置管理
 *
 * 优先级：环境变量 > ~/.shimo/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.shimo');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_BASE_URL = 'https://shimo.zhenguanyu.com';
const DEFAULT_API_KEY = 'Vxur4cvbn7Y4ZRQkyb75dzKQdBFsVw809zooy5HW+ng';

interface Config {
  base_url?: string;
  token?: string;
  api_key?: string;
}

function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function getBaseUrl(): string {
  return process.env.SHIMO_BASE_URL ?? readConfig().base_url ?? DEFAULT_BASE_URL;
}

export function getToken(): string | undefined {
  return process.env.SHIMO_TOKEN ?? readConfig().token;
}

export function getApiKey(): string {
  return process.env.SHIMO_API_KEY ?? readConfig().api_key ?? DEFAULT_API_KEY;
}

export function saveConfig(token: string, baseUrl?: string): void {
  const existing = readConfig();
  writeConfig({
    ...existing,
    token,
    base_url: baseUrl ?? existing.base_url ?? DEFAULT_BASE_URL,
  });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
