import { devWarn } from '../../utils/devConsole';

const SIG_FILE = 'signature.json';

function normalizeDigestHex(hex: string): string {
  const h = hex.trim().replace(/^sha256:/i, '');
  return h.replace(/[^0-9a-f]/gi, '');
}

async function sha256HexFromString(payload: string): Promise<string> {
  const buf = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToSha256Bytes(hex: string): Uint8Array | null {
  const h = normalizeDigestHex(hex);
  if (h.length !== 64) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * skillpkg 载荷序列化：`signature.json` 不参与摘要；路径排序后按「path + utf8 字节长度 + 内容」拼接。
 */
export function buildCanonicalSignedPayload(files: Record<string, string>): string {
  const paths = Object.keys(files).filter((p) => p !== SIG_FILE && !p.endsWith(`/${SIG_FILE}`));
  paths.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  const parts: string[] = [];
  const enc = new TextEncoder();
  for (const path of paths) {
    const content = files[path] ?? '';
    const byteLen = enc.encode(content).length;
    parts.push(`${path}\n${byteLen}\n${content}`);
  }
  return parts.join('\n--- SKILLPKG PART ---\n');
}

async function computedPayloadDigestHex(files: Record<string, string>): Promise<string> {
  const canonical = buildCanonicalSignedPayload(files);
  return sha256HexFromString(canonical);
}

/** 供测试与外部签名脚本对齐：不含 `signature.json` 的载荷 SHA-256（hex） */
export async function skillPkgPayloadDigestHex(files: Record<string, string>): Promise<string> {
  return computedPayloadDigestHex(files);
}

function base64ToUint8(b64: string): Uint8Array | null {
  try {
    const bin = typeof atob === 'function' ? atob(b64.trim()) : '';
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function verifyEd25519Signature(
  message32: Uint8Array,
  sig: Uint8Array,
  pub: Uint8Array
): Promise<boolean> {
  if (!crypto?.subtle?.importKey || !crypto?.subtle?.verify) return false;
  if (pub.length !== 32 || sig.length !== 64 || message32.length !== 32) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(pub),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      new Uint8Array(sig),
      new Uint8Array(message32)
    );
  } catch {
    return false;
  }
}

export interface SkillPkgSignatureAuditMeta {
  hasEd25519: boolean;
  payloadDigestHex?: string;
  /** SHA-256(raw 32B 公钥) 前 16 位 hex，小写 */
  publicKeyFingerprint?: string;
  trustedEnforced?: boolean;
}

export interface SkillPkgVerifyOutcome {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  audit?: SkillPkgSignatureAuditMeta;
}

export interface SkillPkgVerifyOptions {
  /**
   * 非空时：`signature.json` 含 Ed25519 的包，其 `public_key`（Base64，与文件内一致 trim 后）
   * 必须出现在此列表中。
   */
  trustedSignerPubkeysB64?: readonly string[];
}

/** localStorage：`JSON.stringify(string[])`，每条为 `signature.json` 内 `public_key` 的 Base64 raw 32B */
export const SKILL_TRUSTED_SIGNER_STORAGE_KEY = 'yueliTrustedSkillSignerPubkeys';

export function readTrustedSignerPubkeysB64FromStorage(): readonly string[] | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(SKILL_TRUSTED_SIGNER_STORAGE_KEY);
    if (!raw?.trim()) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const out = parsed.map((x) => String(x).trim()).filter(Boolean);
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** 用于配置 UI：每行一个公钥 Base64 */
export function formatTrustedSignersForEditor(): string {
  const keys = readTrustedSignerPubkeysB64FromStorage();
  return keys?.length ? [...keys].join('\n') : '';
}

/** SHA-256(raw 32B Ed25519 公钥) 前 16 位 hex（小写），用于白名单 `fp:` 条目 */
export async function signerPubkeyFingerprintHex(pub32: Uint8Array): Promise<string | null> {
  if (pub32.length !== 32 || !crypto?.subtle?.digest) return null;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(pub32));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

export async function signerPubkeyFingerprintHexFromB64(pubB64: string): Promise<string | null> {
  const raw = base64ToUint8(pubB64);
  if (!raw || raw.length !== 32) return null;
  return signerPubkeyFingerprintHex(raw);
}

type TrustedSignerToken =
  | { kind: 'pubkey_b64'; value: string }
  | { kind: 'fingerprint_short'; value: string }
  | { kind: 'fingerprint_full'; value: string };

function parseTrustedSignerToken(entry: string): TrustedSignerToken {
  const t = entry.trim();
  const fpPref = /^fp:([0-9a-f]{16})$/i.exec(t);
  if (fpPref) {
    return { kind: 'fingerprint_short', value: fpPref[1].toLowerCase() };
  }
  if (/^[0-9a-f]{16}$/i.test(t)) {
    return { kind: 'fingerprint_short', value: t.toLowerCase() };
  }
  if (/^[0-9a-f]{64}$/i.test(t)) {
    return { kind: 'fingerprint_full', value: t.toLowerCase() };
  }
  return { kind: 'pubkey_b64', value: t };
}

async function publicKeyMatchesTrustedList(
  publicKeyB64: string,
  trusted: readonly string[]
): Promise<boolean> {
  const pk = String(publicKeyB64).trim();
  const fp = await signerPubkeyFingerprintHexFromB64(pk);
  let fullFp: string | null = null;

  for (const entry of trusted) {
    const token = parseTrustedSignerToken(entry);
    if (token.kind === 'pubkey_b64' && token.value === pk) return true;
    if (!fp) continue;
    if (token.kind === 'fingerprint_short' && token.value === fp) return true;
    if (token.kind === 'fingerprint_full') {
      if (!fullFp) {
        const raw = base64ToUint8(pk);
        if (raw?.length === 32 && crypto?.subtle?.digest) {
          const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(raw));
          fullFp = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        }
      }
      if (fullFp && token.value === fullFp) return true;
    }
  }
  return false;
}

/**
 * 若包内含 `signature.json`：校验 `payload_digest` 与载荷一致；可选 `public_key` + `signature`（Base64 raw 32 / 64 字节）做 Ed25519。
 * 若在 opts 中提供非空的 `trustedSignerPubkeysB64`，则还要求 `public_key` 落在该列表。
 * 不含 `signature.json`：skipped。
 */
export async function verifySkillPkgOptional(
  files: Record<string, string>,
  opts?: SkillPkgVerifyOptions
): Promise<SkillPkgVerifyOutcome> {
  const raw = files[SIG_FILE];
  if (raw == null || String(raw).trim() === '') {
    return { ok: true, skipped: true };
  }

  let meta: {
    algorithm?: string;
    payload_digest?: string;
    signature?: string;
    public_key?: string;
  };
  try {
    meta = JSON.parse(raw) as typeof meta;
  } catch {
    return {
      ok: false,
      skipped: false,
      reason: 'signature.json 不是合法 JSON'
    };
  }

  const expectedRaw = meta.payload_digest;
  if (!expectedRaw || typeof expectedRaw !== 'string') {
    return { ok: false, skipped: false, reason: 'signature.json 缺少 payload_digest' };
  }
  const expected = normalizeDigestHex(expectedRaw);
  if (expected.length !== 64) {
    return { ok: false, skipped: false, reason: 'payload_digest 长度非法（期望 64 位 hex）' };
  }

  const computed = await computedPayloadDigestHex(files);
  if (computed.toLowerCase() !== expected.toLowerCase()) {
    return {
      ok: false,
      skipped: false,
      reason: `payload_digest 与包内文件不一致`
    };
  }

  const hasCrypto = !!(meta.signature && meta.public_key);
  const trusted = opts?.trustedSignerPubkeysB64?.filter((s) => String(s).trim()) ?? [];
  const enforceTrust = trusted.length > 0;
  const baseAudit: SkillPkgSignatureAuditMeta = {
    hasEd25519: hasCrypto,
    payloadDigestHex: computed,
    trustedEnforced: enforceTrust
  };

  if (!hasCrypto) {
    return { ok: true, skipped: false, audit: baseAudit };
  }

  const algo = typeof meta.algorithm === 'string' ? meta.algorithm.toLowerCase() : '';
  if (algo && algo !== 'ed25519' && algo !== 'ed25519-sha256-canonical') {
    return {
      ok: false,
      skipped: false,
      reason: `不支持的签名算法: ${meta.algorithm}`
    };
  }

  const messageBytes = hexToSha256Bytes(computed);
  if (!messageBytes) {
    return { ok: false, skipped: false, reason: '内部摘要解析失败' };
  }

  const sig = base64ToUint8(meta.signature!);
  const pub = base64ToUint8(meta.public_key!);
  if (!sig || !pub) {
    return {
      ok: false,
      skipped: false,
      reason: 'signature 或 public_key Base64 非法',
      audit: baseAudit
    };
  }

  const publicKeyFingerprint = await signerPubkeyFingerprintHex(pub);
  const auditWithPk: SkillPkgSignatureAuditMeta = {
    ...baseAudit,
    publicKeyFingerprint: publicKeyFingerprint ?? undefined
  };

  if (!crypto?.subtle?.verify) {
    if (enforceTrust) {
      return {
        ok: false,
        skipped: false,
        reason: '当前环境无法进行 Ed25519 验签（已配置可信发布者列表）',
        audit: auditWithPk
      };
    }
    devWarn('[skillpkg] 当前环境无 Web Crypto verify，跳过 Ed25519（payload_digest 已匹配）');
    return { ok: true, skipped: false, audit: auditWithPk };
  }

  const valid = await verifyEd25519Signature(messageBytes, sig, pub);
  if (!valid) {
    return { ok: false, skipped: false, reason: 'Ed25519 验签失败', audit: auditWithPk };
  }

  if (enforceTrust) {
    const pk = String(meta.public_key).trim();
    const allowed = await publicKeyMatchesTrustedList(pk, trusted);
    if (!allowed) {
      return {
        ok: false,
        skipped: false,
        reason: 'public_key 不在可信发布者列表中',
        audit: auditWithPk
      };
    }
  }

  return { ok: true, skipped: false, audit: auditWithPk };
}
