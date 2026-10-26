export interface OllamaProbeResult {
  ok: boolean;
  models: string[];
  detail?: string;
}

export async function probeOllama(
  baseUrl = 'http://127.0.0.1:11434',
  timeoutMs = 8000
): Promise<OllamaProbeResult> {
  const root = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return { ok: false, models: [], detail: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const models = (json?.models ?? [])
      .map((m: { name?: string }) => String(m?.name ?? '').trim())
      .filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return {
      ok: false,
      models: [],
      detail: e instanceof Error ? e.message : String(e)
    };
  }
}

export async function pullOllamaModel(
  model: string,
  baseUrl = 'http://127.0.0.1:11434',
  timeoutMs = 600_000
): Promise<{ ok: boolean; error?: string }> {
  const root = baseUrl.replace(/\/$/, '');
  const name = model.trim();
  if (!name) return { ok: false, error: '模型名不能为空' };
  try {
    const res = await fetch(`${root}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
