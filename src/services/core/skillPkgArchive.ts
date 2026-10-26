/**
 * .skillpkg / .tar.gz 容器：POSIX ustar tar + gzip。
 * 浏览器用 DecompressionStream；Node 测试/脚本侧可用 zlib（见 __tests__）。
 */

const TAR_BLOCK = 512;

export function isSkillPkgArchiveUrl(url: string): boolean {
  const u = url.trim().split('?')[0].toLowerCase();
  return u.endsWith('.skillpkg') || u.endsWith('.tar.gz') || u.endsWith('.tgz');
}

function parseTarSizeOctal(header: Uint8Array, offset: number, len: number): number {
  const slice = header.subarray(offset, offset + len);
  let s = '';
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (c === 0 || c === 32) break;
    s += String.fromCharCode(c);
  }
  const n = parseInt(s.trim(), 8);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTarPath(name: string): string | null {
  const n = name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!n || n.includes('..') || n.startsWith('/')) return null;
  return n;
}

/** 从未压缩 tar 字节解析出 UTF-8 文本文件（仅 regular file） */
export function extractTarUtf8Files(tarBytes: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  const dec = new TextDecoder('utf-8');
  let offset = 0;

  while (offset + TAR_BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + TAR_BLOCK);
    offset += TAR_BLOCK;

    const allZero = header.every((b) => b === 0);
    if (allZero) break;

    const nameRaw = dec.decode(header.subarray(0, 100)).replace(/\0/g, '').trim();
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0/g, '').trim();
    const fullName = prefix ? `${prefix}/${nameRaw}` : nameRaw;
    const path = normalizeTarPath(fullName);
    if (!path) continue;

    const typeFlag = header[156];
    const size = parseTarSizeOctal(header, 124, 12);
    const padded = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    const body = tarBytes.subarray(offset, offset + size);
    offset += padded;

    if (typeFlag === 0 || typeFlag === 48 /* '0' */) {
      files[path] = dec.decode(body);
    }
  }

  return files;
}

export async function gunzipBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(compressed));
    await writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  if (typeof process !== 'undefined' && process.versions?.node) {
    const zlib = await import('node:zlib');
    const out = zlib.gunzipSync(compressed);
    return new Uint8Array(out);
  }

  throw new Error('当前环境不支持 gzip 解压（需要 DecompressionStream 或 Node zlib）');
}

/** 解压 .skillpkg / .tar.gz 为路径 → UTF-8 文本内容 */
export async function extractSkillPkgArchive(compressed: Uint8Array): Promise<Record<string, string>> {
  const tar = await gunzipBytes(compressed);
  return extractTarUtf8Files(tar);
}

export async function fetchSkillPkgArchiveFromUrl(url: string): Promise<Record<string, string>> {
  const res = await fetch(url, { headers: { Accept: 'application/gzip, application/octet-stream,*/*' } });
  if (!res.ok) {
    throw new Error(`拉取 skillpkg 失败: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return extractSkillPkgArchive(buf);
}
