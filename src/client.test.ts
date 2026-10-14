import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShimoClient, ShimoTimeoutError } from './client.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ShimoClient.request', () => {
  it('超时只尝试 1 次并抛 ShimoTimeoutError', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { short: 50, medium: 50, long: 50 },
    });
    const calls: RequestInit[] = [];
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          calls.push(init ?? {});
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    vi.useFakeTimers();
    const promise = client.info('f').catch((e) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await promise;
    vi.useRealTimers();

    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(ShimoTimeoutError);
    const timeoutErr = err as ShimoTimeoutError;
    expect(timeoutErr.timeoutMs).toBe(50);
    expect(timeoutErr.path).toBe('/lizard-api/files/f');
    expect(timeoutErr.message).toBe('请求超时 (50ms): /lizard-api/files/f');
  });

  it('5xx 仍重试 2 次后成功', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { short: 50, medium: 50, long: 50 },
    });
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response(null, {
          status: 500,
          statusText: 'Internal Server Error',
        });
      }
      return new Response(
        JSON.stringify({
          id: 1,
          guid: 'g',
          name: 'n',
          type: 'mosheet',
          url: 'u',
          userId: 1,
          teamId: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.useFakeTimers();
    const promise = client.info('f');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ guid: 'g' });
  });
});

describe('ShimoClient.catSheet', () => {
  function makeClient() {
    return new ShimoClient('https://x', 't', 'k', {
      timeouts: { short: 5000, medium: 5000, long: 5000 },
    });
  }

  function mockContentAndValues(
    fetchMock: (url: string, init?: RequestInit) => unknown,
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return new Response(
            '["B:Sheet1","C*0","B:Sheet2","C*1","B:Sheet3","C*2"]',
            {
              status: 200,
              headers: { 'content-type': 'text/plain' },
            },
          );
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          return fetchMock(u);
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );
  }

  function mockEightSheets(
    fetchMock: (url: string, init?: RequestInit) => unknown,
  ): string[] {
    const names = Array.from({ length: 8 }, (_, i) => `Sheet${i + 1}`);
    const tokens: string[] = [];
    names.forEach((n, i) => {
      tokens.push(`"B:${n}"`, `"C*${i}"`);
    });
    const contentBody = `[${tokens.join(',')}]`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return new Response(contentBody, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          return fetchMock(u, init);
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );
    return names;
  }

  it('并发读取多个 sheet，顺序与 sheet 顺序一致且总耗时低于 250ms', async () => {
    const client = makeClient();
    const sheetValues: Record<string, unknown[][]> = {
      Sheet1: [['a1']],
      Sheet2: [['a2']],
      Sheet3: [['a3']],
    };
    const fetchMock = vi.fn(async (u: string) => {
      await sleep(100);
      const range = decodeURIComponent(
        new URL(u).searchParams.get('range') ?? '',
      );
      return new Response(
        JSON.stringify({ values: sheetValues[range] ?? [] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    mockContentAndValues(fetchMock);

    const start = performance.now();
    const results = await client.catSheet('f');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(250);
    expect(results.map((r) => r.name)).toEqual(['Sheet1', 'Sheet2', 'Sheet3']);
    expect(results[0].values).toEqual([['a1']]);
    expect(results[1].values).toEqual([['a2']]);
    expect(results[2].values).toEqual([['a3']]);
  });

  it('一个 sheet 超时另一个成功：超时 sheet error 含「未响应」且 values 为空', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { short: 5000, medium: 50, long: 5000 },
    });
    const fetchMock = vi.fn((u: string, init?: RequestInit) => {
      const range = decodeURIComponent(
        new URL(u).searchParams.get('range') ?? '',
      );
      if (range === 'Sheet1') {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ values: [['ok']] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return new Response('["B:Sheet1","C*0","B:Sheet2","C*1"]', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          return fetchMock(u, init);
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );

    const results = await client.catSheet('f');

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Sheet1');
    expect(results[0].values).toEqual([]);
    expect(results[0].error).toContain('未响应');
    expect(results[1].name).toBe('Sheet2');
    expect(results[1].values).toEqual([['ok']]);
    expect(results[1].error).toBeUndefined();
  });

  it('8 个 sheet 并发峰值不超过 5，结果顺序正确且全部成功', async () => {
    const client = makeClient();
    let inFlight = 0;
    let peak = 0;
    const names = mockEightSheets(
      vi.fn(async (u: string) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(50);
        const range = decodeURIComponent(
          new URL(u).searchParams.get('range') ?? '',
        );
        inFlight--;
        return new Response(JSON.stringify({ values: [[range]] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const results = await client.catSheet('f');

    expect(peak).toBeLessThanOrEqual(5);
    expect(results.map((r) => r.name)).toEqual(names);
    expect(results.every((r) => r.error === undefined)).toBe(true);
    results.forEach((r, i) => {
      expect(r.values).toEqual([[names[i]]]);
    });
  });

  it('全部超时：只发 5 个请求，未开始的 sheet 跳过，总耗时受控', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { short: 5000, medium: 50, long: 5000 },
    });
    let valuesCalls = 0;
    const fetchMock = vi.fn((_u: string, init?: RequestInit) => {
      valuesCalls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    mockEightSheets(fetchMock);

    const start = performance.now();
    const results = await client.catSheet('f');
    const elapsed = performance.now() - start;

    expect(valuesCalls).toBe(5);
    expect(results).toHaveLength(8);
    for (let i = 0; i < 5; i++) {
      expect(results[i].error).toContain('未响应');
    }
    for (let i = 5; i < 8; i++) {
      expect(results[i].error).toContain('未读取');
    }
    expect(elapsed).toBeLessThan(200);
  });

  it('预算约束在途请求：整体耗时不超过预算', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { medium: 200, sheetBudget: 300 },
    });
    const names = Array.from({ length: 6 }, (_, i) => `Sheet${i + 1}`);
    const tokens: string[] = [];
    names.forEach((n, i) => {
      tokens.push(`"B:${n}"`, `"C*${i}"`);
    });
    const contentBody = `[${tokens.join(',')}]`;
    const fetchMock = vi.fn((u: string, init?: RequestInit) => {
      const range = decodeURIComponent(
        new URL(u).searchParams.get('range') ?? '',
      );
      if (range === 'Sheet1') {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ values: [['a1']] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }, 150);
        });
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return new Response(contentBody, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          return fetchMock(u, init);
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );

    vi.useFakeTimers();
    const promise = client.catSheet('f');
    let done = false;
    promise.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    vi.useRealTimers();

    const results = await promise;
    expect(results).toHaveLength(6);
    expect(results[0].name).toBe('Sheet1');
    expect(results[0].values).toEqual([['a1']]);
    expect(results[0].error).toBeUndefined();
    for (let i = 1; i < 6; i++) {
      expect(results[i].name).toBe(`Sheet${i + 1}`);
      expect(results[i].values).toEqual([]);
      expect(results[i].error).toBeDefined();
    }
    // Sheet2-5 跑满 medium 超时：归因为服务端未响应
    for (let i = 1; i < 5; i++) {
      expect(results[i].error).toContain('未响应');
    }
    // Sheet6 在 150ms 才开始，超时被剩余预算截成 150ms：归因为预算用完，不是服务端问题；
    // 秒数向上取整，不会渲染成 "0s"
    expect(results[5].error).toContain('时间预算已用完');
    expect(results[5].error).not.toContain('未响应');
    expect(results[5].error).toContain('只剩 1s');
  });

  it('预算用完后不再发请求，未开始的 sheet 跳过', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { medium: 1000, sheetBudget: 100 },
    });
    const names = Array.from({ length: 6 }, (_, i) => `Sheet${i + 1}`);
    const tokens: string[] = [];
    names.forEach((n, i) => {
      tokens.push(`"B:${n}"`, `"C*${i}"`);
    });
    const contentBody = `[${tokens.join(',')}]`;
    let valuesCalls = 0;
    const fetchMock = vi.fn(async (u: string) => {
      valuesCalls++;
      await sleep(120);
      const range = decodeURIComponent(
        new URL(u).searchParams.get('range') ?? '',
      );
      return new Response(JSON.stringify({ values: [[range]] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return new Response(contentBody, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          return fetchMock(u);
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );

    vi.useFakeTimers();
    const promise = client.catSheet('f');
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    const results = await promise;

    expect(valuesCalls).toBe(5);
    expect(results).toHaveLength(6);
    for (let i = 0; i < 5; i++) {
      expect(results[i].error).toBeUndefined();
    }
    expect(results[5].values).toEqual([]);
    expect(results[5].error).toContain('时间预算');
  });
});

describe('ShimoClient.request deadline 约束', () => {
  it('慢速 5xx 受截止时间约束：不再重试并返回 502 错误', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { medium: 1000, sheetBudget: 100 },
    });
    let valuesCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return Promise.resolve(
            new Response('["B:Sheet1","C*0"]', {
              status: 200,
              headers: { 'content-type': 'text/plain' },
            }),
          );
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          valuesCalls++;
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                new Response(null, { status: 502, statusText: 'Bad Gateway' }),
              );
            }, 40);
          });
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );

    vi.useFakeTimers();
    const promise = client.catSheet('f');
    let done = false;
    promise.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();

    expect(done).toBe(true);
    expect(valuesCalls).toBe(1);

    const results = await promise;
    expect(results).toHaveLength(1);
    expect(results[0].values).toEqual([]);
    expect(results[0].error).toContain('502');
  });

  it('body 读取卡死也会超时并抛 ShimoTimeoutError', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { medium: 100 },
    });
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.useFakeTimers();
    const promise = client.getSheetValues('f', 'S1').catch((e) => e);
    await vi.advanceTimersByTimeAsync(110);
    const err = await promise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(ShimoTimeoutError);
    const timeoutErr = err as ShimoTimeoutError;
    expect(timeoutErr.timeoutMs).toBe(100);
  });

  it('有截止时间时网络错误重试也受约束：剩余预算足够则重试成功', async () => {
    const client = new ShimoClient('https://x', 't', 'k', {
      timeouts: { medium: 1000, sheetBudget: 2000 },
    });
    let valuesCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const u = String(url);
        if (u.endsWith('/lizard-api/files/f/content')) {
          return Promise.resolve(
            new Response('["B:Sheet1","C*0"]', {
              status: 200,
              headers: { 'content-type': 'text/plain' },
            }),
          );
        }
        if (u.includes('/api/sas/files/f/sheets/values')) {
          valuesCalls++;
          if (valuesCalls === 1) {
            return Promise.reject(new TypeError('fetch failed'));
          }
          return Promise.resolve(
            new Response(JSON.stringify({ values: [['ok']] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        throw new Error(`unexpected url: ${u}`);
      }),
    );

    vi.useFakeTimers();
    const promise = client.catSheet('f');
    let done = false;
    promise.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();

    expect(done).toBe(true);
    expect(valuesCalls).toBe(2);

    const results = await promise;
    expect(results).toHaveLength(1);
    expect(results[0].values).toEqual([['ok']]);
    expect(results[0].error).toBeUndefined();
  });
});
