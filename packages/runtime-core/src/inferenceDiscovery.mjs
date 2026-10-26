import fs from 'node:fs';
import path from 'node:path';

const ENGINE_BY_PORT = {
  11434: 'ollama',
  8002: 'vmlx',
  8080: 'llama.cpp',
  1234: 'lmstudio',
  8000: 'vllm',
};

const PRIO = { ollama: 1, vmlx: 2, 'llama.cpp': 3, lmstudio: 4, vllm: 5, 'openai-compat': 9 };

/**
 * @param {number} port
 * @param {number} timeoutMs
 */
async function probePort(port, timeoutMs = 2000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: controller.signal });
    if (!res.ok) return null;
    return /** @type {{ data?: Array<{ id?: string; owned_by?: string }> }} */ (
      await res.json()
    );
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} discoveryPortsEnv
 * @param {string} probeDir
 * @param {string} discoveryResultPath
 */
export async function runInferenceDiscovery(discoveryPortsEnv, probeDir, discoveryResultPath) {
  const ports = (discoveryPortsEnv || '11434 8002 8080 1234 8000 5000')
    .trim()
    .split(/\s+/)
    .map((p) => parseInt(p, 10))
    .filter((n) => Number.isFinite(n));

  fs.mkdirSync(probeDir, { recursive: true });

  console.log(`🔎 扫描本机 OpenAI 兼容推理引擎: ports=[${ports.join(' ')}]`);

  /** @type {Array<{ engine: string; port: number; baseUrl: string; models: string[] }>} */
  const engines = [];

  for (const port of ports) {
    const data = await probePort(port);
    const probeFile = path.join(probeDir, `yueli-probe-${port}.json`);
    if (!data?.data?.length) {
      try {
        fs.unlinkSync(probeFile);
      } catch {
        /* ignore */
      }
      continue;
    }
    fs.writeFileSync(probeFile, JSON.stringify(data));

    const models = data.data.filter((m) => m.id).map((m) => m.id);
    if (!models.length) continue;

    const owner = (data.data[0]?.owned_by || '').toLowerCase();
    let engine = owner.includes('library')
      ? 'ollama'
      : owner.includes('vmlx')
        ? 'vmlx'
        : 'openai-compat';
    engine = ENGINE_BY_PORT[port] ?? engine;

    engines.push({
      engine,
      port,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models,
    });

    const preview = models.slice(0, 8).join(',') + (models.length > 8 ? '…' : '');
    console.log(`   ✅ :${port} → ${preview}`);
  }

  const result = { discoveredAt: Date.now() / 1000, engines };
  fs.writeFileSync(discoveryResultPath, JSON.stringify(result, null, 2));
  return result;
}

/**
 * @param {ReturnType<typeof runInferenceDiscovery> extends Promise<infer T> ? T : never} discovery
 */
export function pickLlmAndEmbedding(discovery) {
  const sorted = [...(discovery.engines || [])].sort(
    (a, b) => (PRIO[a.engine] ?? 99) - (PRIO[b.engine] ?? 99)
  );

  /** @type {Array<[string, string]>} */
  const llmCandidates = [];
  /** @type {Array<[string, string]>} */
  const embCandidates = [];

  for (const e of sorted) {
    for (const m of e.models) {
      const ml = (m || '').toLowerCase();
      if (ml.includes('embed')) embCandidates.push([e.baseUrl, m]);
      else llmCandidates.push([e.baseUrl, m]);
    }
  }

  let llmBase = '';
  let llmModel = '';
  for (const [base, m] of llmCandidates) {
    if ((m || '').toLowerCase().includes('qwen')) {
      llmBase = base;
      llmModel = m;
      break;
    }
  }
  if (!llmBase && llmCandidates[0]) {
    llmBase = llmCandidates[0][0];
    llmModel = llmCandidates[0][1];
  }

  let embBase = '';
  let embModel = '';
  if (embCandidates[0]) {
    embBase = embCandidates[0][0];
    embModel = embCandidates[0][1];
  }

  return { llmBase, llmModel, embBase, embModel };
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ llmBase: string; llmModel: string; embBase: string; embModel: string }} auto
 */
export function resolveKgmUpstreamEnv(env, auto) {
  const out = {
    KGM_LLM_BASE_URL: env.KGM_LLM_BASE_URL || '',
    KGM_LLM_API_KEY: env.KGM_LLM_API_KEY || '',
    KGM_LLM_MODEL: env.KGM_LLM_MODEL || '',
    KGM_LLM_PATH: env.KGM_LLM_PATH || '/chat/completions',
    KGM_LLM_MODE: env.KGM_LLM_MODE || 'chat',
    KGM_LLM_PROVIDER: env.KGM_LLM_PROVIDER || 'openai',
    KGM_EMBEDDING_BASE_URL: env.KGM_EMBEDDING_BASE_URL || '',
    KGM_EMBEDDING_API_KEY: env.KGM_EMBEDDING_API_KEY || '',
    KGM_EMBEDDING_MODEL: env.KGM_EMBEDDING_MODEL || '',
    KGM_EMBEDDING_PATH: env.KGM_EMBEDDING_PATH || '/embeddings',
    KGM_EMBEDDING_PROVIDER: env.KGM_EMBEDDING_PROVIDER || 'openai',
  };

  if (!out.KGM_LLM_BASE_URL && auto.llmBase) {
    out.KGM_LLM_BASE_URL = auto.llmBase;
    out.KGM_LLM_MODEL = auto.llmModel;
    if (!out.KGM_LLM_API_KEY) out.KGM_LLM_API_KEY = 'local';
  }
  if (!out.KGM_EMBEDDING_BASE_URL && auto.embBase) {
    out.KGM_EMBEDDING_BASE_URL = auto.embBase;
    out.KGM_EMBEDDING_MODEL = auto.embModel;
    if (!out.KGM_EMBEDDING_API_KEY) out.KGM_EMBEDDING_API_KEY = 'local';
  }

  return out;
}
