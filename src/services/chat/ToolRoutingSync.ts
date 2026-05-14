import apiService from '../../api/services/apiService';
import type { SkillExecutor } from '../SkillExecutor';
import { DEFAULT_TOOL_ROUTING_COLLECTION, YUELI_SKILL_ROUTING_KIND } from './ToolRoutingRecall';

export interface ToolRoutingSyncResult {
  stored: number;
  errors: string[];
}

/**
 * 将当前候选技能的 OpenAI tools 描述写入 KGM memory，供 recallSkillRoutingScoresFromMemory 使用。
 */
export async function syncToolRoutingIndexForSkills(
  skillExecutor: SkillExecutor,
  skillIds: string[],
  collection?: string
): Promise<ToolRoutingSyncResult> {
  const coll =
    collection?.trim() ||
    (typeof window !== 'undefined' && window.localStorage?.getItem('yueli_tool_routing_collection')?.trim()) ||
    DEFAULT_TOOL_ROUTING_COLLECTION;

  const errors: string[] = [];
  let stored = 0;
  const unique = Array.from(new Set(skillIds.filter(Boolean)));

  for (const sid of unique) {
    try {
      const defs = skillExecutor.getAllToolDefinitions([sid]) as Array<{
        function?: { name?: string; description?: string };
      }>;
      if (!defs?.length) continue;
      const lines = defs.map((d) => {
        const name = d?.function?.name || '';
        const desc = String(d?.function?.description || '').slice(0, 800);
        return `${name}: ${desc}`;
      });
      const content = [`skill_id: ${sid}`, '', ...lines].join('\n');
      const ret = await apiService.kgmMemoryStore(
        content,
        { yueliKind: YUELI_SKILL_ROUTING_KIND, skillId: sid },
        coll
      );
      if (!ret) {
        errors.push(`${sid}: KGM memory 写入失败（检查 KGM / embedding 配置）`);
        continue;
      }
      stored++;
    } catch (e) {
      errors.push(`${sid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { stored, errors };
}
