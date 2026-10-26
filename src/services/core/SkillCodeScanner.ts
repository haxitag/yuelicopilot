import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import type { SkillManifest } from './SkillManifestSchema';

export interface CodeScanViolation {
  file: string;
  line?: number;
  message: string;
  capability: string;
}

export interface CodeScanResult {
  declared_capabilities: string[];
  detected_capabilities: string[];
  undeclared: string[];
  violations: CodeScanViolation[];
  ok: boolean;
}

const FS_MODULES = new Set([
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
  'path',
  'node:path'
]);

const PROCESS_MODULES = new Set(['child_process', 'node:child_process', 'execa']);

const NETWORK_MODULES = new Set([
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dgram',
  'axios',
  'node:http',
  'node:https',
  'got',
  'node-fetch'
]);

const CAPABILITY_PATTERNS: Record<string, RegExp[]> = {
  network: [/\bfetch\s*\(/, /\baxios\b/, /\bhttp\.request\b/, /\bhttps\.request\b/],
  filesystem: [
    /\brequire\s*\(\s*['"]fs['"]/,
    /\bfrom\s+['"]fs['"]/,
    /\bfs\.promises\b/,
    /\breadFileSync\b/,
    /\bwriteFileSync\b/
  ],
  process: [
    /\brequire\s*\(\s*['"]child_process['"]/,
    /\bfrom\s+['"]child_process['"]/,
    /\bchild_process\b/,
    /\bexecSync\b/,
    /\bspawn\s*\(/
  ]
};

const SCANNABLE_EXT = /\.(js|mjs|cjs|ts|tsx)$/i;
const AST_PREFERRED_EXT = /\.(js|mjs|cjs)$/i;

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function capsFromManifest(manifest: SkillManifest): Record<string, boolean> {
  const c = manifest.capabilities || {};
  return {
    network: !!c.network,
    filesystem: !!c.filesystem,
    process: !!(c.process || (manifest.permissions || []).some((p) => /execute|process/i.test(String(p))))
  };
}

function capabilityForModule(mod: string): 'filesystem' | 'process' | 'network' | null {
  const m = mod.replace(/^node:/, '');
  if (FS_MODULES.has(mod) || FS_MODULES.has(m)) return 'filesystem';
  if (PROCESS_MODULES.has(mod) || PROCESS_MODULES.has(m)) return 'process';
  if (NETWORK_MODULES.has(mod) || NETWORK_MODULES.has(m)) return 'network';
  return null;
}

function scanWithRegex(
  source: string,
  filePath: string,
  declared: Record<string, boolean>,
  detected: Set<string>,
  violations: CodeScanViolation[]
): void {
  for (const [cap, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
    for (const re of patterns) {
      re.lastIndex = 0;
      const m = re.exec(source);
      if (!m) continue;
      detected.add(cap);
      if (!declared[cap as keyof typeof declared]) {
        violations.push({
          file: filePath,
          line: lineNumberAt(source, m.index),
          capability: cap,
          message: `检测到 ${cap} 相关 API，但 manifest.capabilities.${cap} 未声明为 true`
        });
      }
      break;
    }
  }
}

function scanWithAcorn(
  source: string,
  filePath: string,
  declared: Record<string, boolean>,
  detected: Set<string>,
  violations: CodeScanViolation[]
): boolean {
  let ast: any;
  try {
    ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true
    });
  } catch {
    return false;
  }

  const noteViolation = (cap: string, line?: number) => {
    detected.add(cap);
    if (!declared[cap as keyof typeof declared]) {
      violations.push({
        file: filePath,
        line,
        capability: cap,
        message: `检测到 ${cap} 相关 API，但 manifest.capabilities.${cap} 未声明为 true`
      });
    }
  };

  simple(ast as any, {
    CallExpression(node: any) {
      const line = node.loc?.start?.line;
      const callee = node.callee;
      if (callee?.type === 'Identifier' && callee.name === 'fetch') {
        noteViolation('network', line);
        return;
      }
      if (
        callee?.type === 'Identifier' &&
        callee.name === 'require' &&
        node.arguments[0]?.type === 'Literal' &&
        typeof node.arguments[0].value === 'string'
      ) {
        const cap = capabilityForModule(node.arguments[0].value as string);
        if (cap) noteViolation(cap, line);
      }
      if (
        callee?.type === 'MemberExpression' &&
        callee.property?.type === 'Identifier' &&
        callee.property.name === 'fetch'
      ) {
        noteViolation('network', line);
      }
    },
    ImportDeclaration(node: any) {
      const line = node.loc?.start?.line;
      const src = node.source?.value;
      if (typeof src !== 'string') return;
      const cap = capabilityForModule(src);
      if (cap) noteViolation(cap, line);
    }
  });

  return true;
}

async function transpileTsLike(source: string, isTsx: boolean): Promise<string | null> {
  try {
    const ts = await import('typescript');
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: isTsx ? ts.JsxEmit.React : ts.JsxEmit.Preserve,
        esModuleInterop: true,
        isolatedModules: true
      }
    }).outputText;
    return out?.trim() ? out : null;
  } catch {
    return null;
  }
}

/**
 * 静态扫描：`.js/.mjs/.cjs` 用 acorn-walk；`.ts/.tsx` 先 `typescript.transpileModule` 再 acorn；失败回落正则。
 */
export async function scanSkillCodeFiles(
  files: Record<string, string>,
  manifest: SkillManifest
): Promise<CodeScanResult> {
  const declared = capsFromManifest(manifest);
  const declared_capabilities = Object.entries(declared)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const detected = new Set<string>();
  const violations: CodeScanViolation[] = [];

  for (const [filePath, source] of Object.entries(files)) {
    if (!SCANNABLE_EXT.test(filePath) || !source) continue;

    let astOk = false;
    if (AST_PREFERRED_EXT.test(filePath)) {
      astOk = scanWithAcorn(source, filePath, declared, detected, violations);
    } else if (/\.tsx?$/i.test(filePath)) {
      const js = await transpileTsLike(source, /\.tsx$/i.test(filePath));
      if (js) {
        astOk = scanWithAcorn(js, filePath, declared, detected, violations);
      }
    }
    if (!astOk) {
      scanWithRegex(source, filePath, declared, detected, violations);
    }
  }

  const detected_capabilities = [...detected];
  const undeclared = detected_capabilities.filter((c) => !declared_capabilities.includes(c));

  return {
    declared_capabilities,
    detected_capabilities,
    undeclared,
    violations,
    ok: violations.length === 0
  };
}

export function formatScanFailures(result: CodeScanResult): string {
  if (result.ok) return '';
  return result.violations
    .map((v) => `${v.file}${v.line ? `:${v.line}` : ''} — ${v.message}`)
    .join('; ');
}
