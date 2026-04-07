/**
 * ShimoClient — 石墨文档 API SDK
 *
 * 统一封装所有石墨 API 调用，CLI 和 MCP 共享同一个 client。
 *
 * 关键特性：
 * - 分级超时：文件信息 10s，内容读取 30s，批量 60s
 * - 自动重试：网络错误/5xx 重试 2 次（1s, 3s 指数退避）
 * - 自动获取 sheet 名称：从 content API 解析 "B:xxx"
 * - 鉴权分层：lizard-api 用 Bearer，api/sas 用裸 token
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShimoUser {
  id: number;
  name: string;
  email: string;
  avatar: string;
  team?: {
    id: number;
    name: string;
  };
}

export interface ShimoFile {
  id: number;
  guid: string;
  name: string;
  type: string;
  url: string;
  userId: number;
  teamId: number;
  createdAt: string;
  updatedAt: string;
  user?: { id: number; name: string; email: string };
}

export interface ShimoHistory {
  id: string;
  content: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  historyType: number;
  name: string;
}

export interface ShimoMention {
  userId: string;
  atGuid: string;
}

export interface SheetInfo {
  name: string;
  index: number;
}

export interface SheetData {
  name: string;
  values: unknown[][];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIMEOUT_SHORT = 10_000;
const TIMEOUT_MEDIUM = 30_000;
const TIMEOUT_LONG = 60_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ShimoClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private apiKey: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // -------------------------------------------------------------------------
  // Internal HTTP
  // -------------------------------------------------------------------------

  private async request<T>(
    path: string,
    opts: {
      timeout?: number;
      auth?: 'bearer' | 'raw';
      init?: RequestInit;
    } = {},
  ): Promise<T> {
    const { timeout = TIMEOUT_SHORT, auth = 'bearer', init } = opts;
    const url = `${this.baseUrl}${path}`;
    const authorization =
      auth === 'bearer' ? `Bearer ${this.token}` : this.token;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS[attempt - 1]);
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(url, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: authorization,
            'x-shimo-api-key': this.apiKey,
            ...init?.headers,
          },
        });
        clearTimeout(timer);

        if (res.status >= 500 && attempt < MAX_RETRIES) {
          lastError = new Error(`${res.status} ${res.statusText}`);
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(
            `HTTP ${res.status}: ${body || res.statusText}`.trim(),
          );
        }

        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) return (await res.json()) as T;
        return (await res.text()) as unknown as T;
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === 'AbortError'
        ) {
          lastError = new Error(`请求超时 (${timeout}ms): ${path}`);
          if (attempt < MAX_RETRIES) continue;
        } else if (
          err instanceof TypeError &&
          String(err.message).includes('fetch')
        ) {
          lastError = err as Error;
          if (attempt < MAX_RETRIES) continue;
        } else {
          throw err;
        }
      }
    }
    throw lastError ?? new Error(`请求失败: ${path}`);
  }

  // -------------------------------------------------------------------------
  // 认证
  // -------------------------------------------------------------------------

  async me(): Promise<ShimoUser> {
    return this.request('/lizard-api/users/me', { timeout: TIMEOUT_SHORT });
  }

  // -------------------------------------------------------------------------
  // 文件浏览
  // -------------------------------------------------------------------------

  async ls(folderId?: string): Promise<ShimoFile[]> {
    const params = folderId ? `?folder=${folderId}` : '';
    return this.request(`/lizard-api/files${params}`, {
      timeout: TIMEOUT_MEDIUM,
    });
  }

  async info(fileId: string): Promise<ShimoFile> {
    return this.request(`/lizard-api/files/${fileId}`, {
      timeout: TIMEOUT_SHORT,
    });
  }

  async recent(): Promise<ShimoFile[]> {
    return this.request('/lizard-api/files/recent', {
      timeout: TIMEOUT_MEDIUM,
    });
  }

  // -------------------------------------------------------------------------
  // 文档内容
  // -------------------------------------------------------------------------

  async cat(fileId: string): Promise<string> {
    const data = await this.request<{ content: string }>(
      `/sdk/v2/collab-files/${fileId}/plain-text`,
      { timeout: TIMEOUT_MEDIUM },
    );
    return data.content;
  }

  // -------------------------------------------------------------------------
  // 表格操作
  // -------------------------------------------------------------------------

  /** 从 content API 解析 sheet 名称列表 */
  async sheets(fileId: string): Promise<SheetInfo[]> {
    const raw = await this.request<string>(
      `/lizard-api/files/${fileId}/content`,
      { timeout: TIMEOUT_MEDIUM },
    );
    const names = [...raw.matchAll(/"B:([^"]+)"/g)].map((m) => m[1]);
    const indices = [...raw.matchAll(/"C\*(\d+)"/g)].map((m) =>
      Number.parseInt(m[1], 10),
    );
    return names.map((name, i) => ({
      name,
      index: indices[i] ?? i,
    }));
  }

  /** 获取表格指定范围的值 */
  async getSheetValues(
    fileId: string,
    range: string,
  ): Promise<unknown[][]> {
    const data = await this.request<{ values: unknown[][] }>(
      `/api/sas/files/${fileId}/sheets/values?range=${encodeURIComponent(range)}`,
      { timeout: TIMEOUT_MEDIUM, auth: 'raw' },
    );
    return data.values;
  }

  /**
   * 读取表格内容（智能模式）
   * - 不传 sheetName：读取所有 sheet
   * - 传 sheetName：只读该 sheet
   * - 传 range：读指定范围（如 "A1:C10"）
   */
  async catSheet(
    fileId: string,
    sheetName?: string,
    range?: string,
  ): Promise<SheetData[]> {
    const sheetList = await this.sheets(fileId);
    if (sheetList.length === 0) {
      throw new Error('该文件没有找到任何工作表');
    }

    const targets = sheetName
      ? sheetList.filter(
          (s) => s.name === sheetName || s.name.toLowerCase() === sheetName.toLowerCase(),
        )
      : sheetList;

    if (targets.length === 0) {
      const available = sheetList.map((s) => s.name).join(', ');
      throw new Error(
        `找不到工作表 "${sheetName}"。可用: ${available}`,
      );
    }

    const results: SheetData[] = [];
    for (const sheet of targets) {
      const r = range ? `${sheet.name}!${range}` : sheet.name;
      try {
        const values = await this.getSheetValues(fileId, r);
        results.push({ name: sheet.name, values });
      } catch (err) {
        results.push({
          name: sheet.name,
          values: [[`读取失败: ${err instanceof Error ? err.message : err}`]],
        });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // 协作信息
  // -------------------------------------------------------------------------

  async history(
    fileId: string,
    pageSize = 20,
  ): Promise<{ histories: ShimoHistory[]; isLastPage: boolean }> {
    return this.request(
      `/sdk/v2/collab-files/${fileId}/doc-sidebar-info?pageSize=${pageSize}`,
      { timeout: TIMEOUT_MEDIUM },
    );
  }

  async mentions(fileId: string): Promise<ShimoMention[]> {
    const data = await this.request<{ mentionAtList: ShimoMention[] }>(
      `/sdk/v2/collab-files/${fileId}/mention-at-list`,
      { timeout: TIMEOUT_MEDIUM },
    );
    return data.mentionAtList;
  }

  async commentCount(fileId: string): Promise<number> {
    const data = await this.request<{ count: number }>(
      `/sdk/v2/collab-files/${fileId}/comment-count`,
      { timeout: TIMEOUT_SHORT },
    );
    return data.count;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
