import {
  resolveSkillExecutorAuthHeaders,
  resolveSkillExecutorBaseUrl
} from '../../utils/skillExecutorUrl';
import { devWarn } from '../../utils/devConsole';
import type { PdfPipelineRoleOutput, PdfPipelineRoleId } from './types';

const SKILL_IDS: Record<PdfPipelineRoleId, string> = {
  indexer: 'yueli-pdf-indexer',
  structural_analyst: 'yueli-pdf-structural-analyst',
  summarizer: 'yueli-pdf-summarizer',
  paraphraser: 'yueli-pdf-paraphraser',
  data_extractor: 'yueli-pdf-data-extractor',
  rag_curator: 'yueli-pdf-rag-curator'
};

function mapExecutorRole(r: {
  roleId?: string;
  displayName?: string;
  content?: string;
  result?: string;
  success?: boolean;
}): PdfPipelineRoleOutput | null {
  if (!r.roleId || r.success === false) return null;
  return {
    roleId: r.roleId as PdfPipelineRoleId,
    displayName: r.displayName || r.roleId,
    content: String(r.content || r.result || '')
  };
}

/** POST /v1/documents/run-role-pipeline — 四角色并行 */
export async function runPdfRolesViaExecutorPipeline(params: {
  text: string;
  fileName: string;
  userNote: string;
}): Promise<PdfPipelineRoleOutput[]> {
  const base = resolveSkillExecutorBaseUrl();
  let resp: Response;
  try {
    resp = await fetch(`${base}/v1/documents/run-role-pipeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...resolveSkillExecutorAuthHeaders()
    },
    body: JSON.stringify(params)
    });
  } catch {
    devWarn('[pdfSkillPipeline] run-role-pipeline 不可达');
    return [];
  }
  if (!resp.ok) {
    devWarn('[pdfSkillPipeline] run-role-pipeline HTTP', resp.status);
    return [];
  }
  const json = await resp.json();
  const roles = (json.roles || [])
    .map((r: Parameters<typeof mapExecutorRole>[0]) => mapExecutorRole(r))
    .filter((x: PdfPipelineRoleOutput | null): x is PdfPipelineRoleOutput => x !== null);
  return roles;
}

/** 四路 POST /v1/skill/execute 并行（真实 Skill 注册表） */
export async function runPdfRolesViaSkillExecute(params: {
  text: string;
  fileName: string;
  userNote: string;
}): Promise<PdfPipelineRoleOutput[]> {
  const base = resolveSkillExecutorBaseUrl();
  const roleIds: PdfPipelineRoleId[] = [
    'structural_analyst',
    'summarizer',
    'paraphraser',
    'data_extractor'
  ];
  const skillIds = roleIds
    .map((r) => SKILL_IDS[r])
    .filter((id) => id && !id.includes('indexer') && !id.includes('rag'));

  const results = await Promise.all(
    ['yueli-pdf-structural-analyst', 'yueli-pdf-summarizer', 'yueli-pdf-paraphraser', 'yueli-pdf-data-extractor'].map(
      async (skill_id) => {
        try {
          const resp = await fetch(`${base}/v1/skill/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...resolveSkillExecutorAuthHeaders()
            },
            body: JSON.stringify({
              skill_id,
              context: {
                userInput: params.userNote,
                variables: { pdfText: params.text, fileName: params.fileName }
              }
            })
          });
          if (!resp.ok) return null;
          const json = await resp.json();
          const roleId = Object.entries(SKILL_IDS).find(([, sid]) => sid === skill_id)?.[0] as
            | PdfPipelineRoleId
            | undefined;
          if (!roleId) return null;
          return {
            roleId,
            displayName: json.displayName || roleId,
            content: String(json.result || '')
          } satisfies PdfPipelineRoleOutput;
        } catch {
          return null;
        }
      }
    )
  );
  void skillIds;
  return results.filter((x): x is PdfPipelineRoleOutput => x !== null);
}
