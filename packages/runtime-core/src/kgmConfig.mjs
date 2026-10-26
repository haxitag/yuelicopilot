import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {Record<string, string>} upstream
 * @param {string} configPath
 * @param {string} dbFilePath
 */
export function writeKgmConfigIfLlmPresent(upstream, configPath, dbFilePath) {
  if (!upstream.KGM_LLM_BASE_URL) {
    console.log(`   ℹ️  未发现本地 LLM，保留 KGM 现有 config: ${configPath}`);
    return null;
  }

  const lp = (upstream.KGM_LLM_PROVIDER || 'openai').toLowerCase();
  const routeSegment = lp === 'ollama' ? 'ollama' : 'openai-compat';
  const routeKey = `default:${routeSegment}:${upstream.KGM_LLM_MODEL}`;

  const config = {
    embedding: {
      provider: upstream.KGM_EMBEDDING_PROVIDER || 'openai',
      baseUrl: upstream.KGM_EMBEDDING_BASE_URL || upstream.KGM_LLM_BASE_URL,
      apiKey: upstream.KGM_EMBEDDING_API_KEY || upstream.KGM_LLM_API_KEY,
      model: upstream.KGM_EMBEDDING_MODEL || 'nomic-embed-text:latest',
      path: upstream.KGM_EMBEDDING_PATH || '/embeddings',
      version: 'canon-2025-01-openai',
      timeoutMs: 15000,
    },
    llm: {
      provider: upstream.KGM_LLM_PROVIDER,
      baseUrl: upstream.KGM_LLM_BASE_URL,
      apiKey: upstream.KGM_LLM_API_KEY,
      model: upstream.KGM_LLM_MODEL,
      path: upstream.KGM_LLM_PATH,
      mode: upstream.KGM_LLM_MODE,
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 120000,
    },
    database: {
      provider: 'sqlite',
      filePath: dbFilePath,
      journalMode: 'WAL',
    },
    vector: {
      backend: 'memory',
      collection: 'kgm_memory',
      distance: 'cosine',
      timeoutMs: 15000,
    },
    context: {
      artifactDir: 'data/artifacts',
      sessionDir: 'data/sessions',
      maxToolOutputChars: 2000,
      maxEvidenceChars: 800,
      artifactPreviewChars: 240,
      sessionPreviewChars: 240,
      retrievalCacheTtlMs: 0,
      enableArtifactTool: true,
      enableSessionTool: true,
      enableToolCatalogTool: true,
      toolDescriptorMode: 'names',
      includeSkillNames: true,
    },
    adapter: { enabled: false },
    ycb: { enabled: false },
    routing: {
      version: 'route-local-auto',
      updatedAt: new Date().toISOString(),
      baseWeights: { [routeKey]: 1.0 },
      routes: [
        {
          name: 'general_default',
          priority: 10,
          match: { purpose: 'general' },
          strategy: { type: 'weighted', weights: { [routeKey]: 1.0 } },
        },
      ],
    },
    autoRouting: {
      enabled: false,
      allowDynamicSelection: false,
      auditEnabled: false,
      defaultProfile: 'manual',
      preferVerifiableTasks: false,
      evaluation: {
        enabled: false,
        fallbackToHeuristics: true,
        judge: { enabled: false, target: {}, maxTokens: 0, temperature: 0, timeoutMs: 0 },
        verifier: { enabled: false, target: {}, maxTokens: 0, temperature: 0, timeoutMs: 0 },
      },
    },
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`   📝 写入本地化 kgm.config.json → ${configPath}`);
  console.log(
    '      (autoRouting 已关闭：避免默认配置里虚假云端路由触发 judge/verifier 的 fetch 失败)'
  );
  console.log(
    `      routes 单键: ${routeKey}  （llm.provider 仍为实际协议配置；中段 ${routeSegment} 与 KGM 拓扑 routeKey 对齐）`
  );

  return routeKey;
}

/**
 * @param {Record<string, string>} upstream
 */
export function logUpstreamSummary(upstream) {
  if (upstream.KGM_LLM_BASE_URL) {
    console.log(
      `   📡 LLM (路径①)  : ${upstream.KGM_LLM_BASE_URL}  model=${upstream.KGM_LLM_MODEL}`
    );
  } else {
    console.log(
      '   ⚠️  未发现任何本地 LLM 引擎，KGM 将仅依赖原生推理(路径③)或外部云端 provider'
    );
    console.log('      手动指定: export KGM_LLM_BASE_URL=… KGM_LLM_API_KEY=… KGM_LLM_MODEL=…');
  }
  if (upstream.KGM_EMBEDDING_BASE_URL) {
    console.log(
      `   📡 Embedding    : ${upstream.KGM_EMBEDDING_BASE_URL}  model=${upstream.KGM_EMBEDDING_MODEL}`
    );
  } else {
    console.log(
      "   ⚠️  未发现 embedding 模型，KGM 的 memory/RAG 上下文构建会报 'embedding apiKey is required'"
    );
    console.log(
      '      建议: ollama pull nomic-embed-text; 或 export KGM_EMBEDDING_BASE_URL=… …'
    );
  }
}
