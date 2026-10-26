import { useEffect, useState } from 'react';
import { probeKgmModelRoutable } from '../services/chat/kgmModelCatalog';
import type { ModelOption } from '../services/chat/ModelOptions';
import type { TieredModelOption } from '../services/chat/inferenceModelTiers';
import { normalizeBrowserKgmBaseUrl } from '../utils/kgmBrowserBaseUrl';

export function useL2ModelRoutability(
  modelOptions: (ModelOption | TieredModelOption)[]
): { routability: Map<string, boolean>; probing: boolean } {
  const [routability, setRoutability] = useState<Map<string, boolean>>(new Map());
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    const tiered = modelOptions.filter(
      (o): o is TieredModelOption => 'tier' in o && o.tier === 'L2'
    );
    if (tiered.length === 0) {
      setRoutability(new Map());
      return;
    }

    let cancelled = false;
    setProbing(true);

    void (async () => {
      const viteEnv = (import.meta as { env?: Record<string, string> }).env ?? {};
      const raw =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('kgmBaseUrl') || '/kgm'
          : '/kgm';
      const root = normalizeBrowserKgmBaseUrl(raw, viteEnv);
      const next = new Map<string, boolean>();
      for (const o of tiered) {
        if (cancelled) break;
        const model = o.value.split(':').slice(1).join(':');
        const ok = await probeKgmModelRoutable(root, model);
        next.set(o.value, ok);
      }
      if (!cancelled) {
        setRoutability(next);
        setProbing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [modelOptions]);

  return { routability, probing };
}
