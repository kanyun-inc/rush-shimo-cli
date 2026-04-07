/**
 * 石墨 URL 解析
 *
 * 支持的格式：
 *   https://shimo.zhenguanyu.com/sheets/{fileId}/{sheetId}/
 *   https://shimo.zhenguanyu.com/sheets/{fileId}
 *   https://shimo.zhenguanyu.com/docs/{fileId}
 *   https://shimo.zhenguanyu.com/docx/{fileId}
 *   https://shimo.zhenguanyu.com/folder/{folderId}
 *   裸 fileId 字符串
 */

export function extractFileId(input: string): string | null {
  // 如果是 URL，从路径中提取
  if (input.includes('/')) {
    const match = input.match(/\/(?:sheets|docs|docx)\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }
  // 裸 ID：只含字母数字
  if (/^[a-zA-Z0-9]+$/.test(input)) return input;
  return null;
}

export function extractFolderId(input: string): string | null {
  if (input.includes('/')) {
    const match = input.match(/\/folder\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  }
  if (/^[a-zA-Z0-9]+$/.test(input)) return input;
  return null;
}

/** 从 fileUrl 或 fileId 中解析出 fileId，优先用 fileId */
export function resolveFileId(fileUrl?: string, fileId?: string): string {
  if (fileId) return fileId;
  if (fileUrl) {
    const id = extractFileId(fileUrl);
    if (id) return id;
    throw new Error(`无法从 URL 中提取文件 ID: ${fileUrl}`);
  }
  throw new Error('请提供 fileUrl 或 fileId');
}
