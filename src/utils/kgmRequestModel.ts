/**
 * Copilot → KGM `/v1/chat/completions` 的 model 字段规范化。
 *
 * UI 使用 `kgm:kgm-dynamic` / `kgm:cloud` 等标签；KGM 对外暴露的路由入口为 `auto`
 *（见 `/v1/models` 中 modelType=routing-entry）。真实上游（L1 Playground / L2 管理中心 MaaS）
 * 由 KGM 按 routes 优先级选用，前端不直连 cloudProviders 中的外网 URL。
 */

const KGM_ROUTING_MODEL_ALIASES: Record<string, string> = {
  'kgm-dynamic': 'auto',
  cloud: 'auto'
};

export function normalizeKgmRequestModelForApi(model: string): string {
  if (!model) return model;
  let bare = model;
  const idx = model.indexOf(':');
  if (idx >= 0 && model.slice(0, idx) === 'kgm') {
    bare = model.slice(idx + 1);
  }
  return KGM_ROUTING_MODEL_ALIASES[bare] ?? bare;
}
