import type { SkillManifest } from '../core/SkillManifestSchema';
import type { CoreOrchestratorV2 } from '../core/CoreOrchestratorV2';
/** 附件文本块（与 chatFilePromptText 对齐，text 在过滤后保证存在） */
export interface PdfAttachmentBlock {
  name: string;
  text: string;
  error?: string;
}
import type { PdfPipelineRoleId, PdfPipelineRoleOutput } from './types';
import { buildSkillInjectionPlan } from '../core/skillInjectionPlan';
import { devLog } from '../../utils/devConsole';

/** 与 server/lib/pdfRoleSkills.mjs PDF_SKILL_ID_TO_ROLE 对齐 */
export const PDF_PRE_PIPELINE_SKILL_IDS = [
  'yueli-pdf-structural-analyst',
  'yueli-pdf-summarizer',
  'yueli-pdf-paraphraser',
  'yueli-pdf-data-extractor'
] as const;

export type PdfPrePipelineSkillId = (typeof PDF_PRE_PIPELINE_SKILL_IDS)[number];

const SKILL_ID_TO_ROLE: Record<PdfPrePipelineSkillId, PdfPipelineRoleId> = {
  'yueli-pdf-structural-analyst': 'structural_analyst',
  'yueli-pdf-summarizer': 'summarizer',
  'yueli-pdf-paraphraser': 'paraphraser',
  'yueli-pdf-data-extractor': 'data_extractor'
};

const ROLE_DISPLAY: Record<PdfPipelineRoleId, string> = {
  structural_analyst: '结构分析员',
  summarizer: '摘要员',
  paraphraser: '转述员',
  data_extractor: '数据抽取员',
  indexer: '索引员',
  rag_curator: 'RAG 策展员'
};

export interface PdfAttachmentContext {
  blocks: PdfAttachmentBlock[];
  userNote: string;
  /** 多文件时以首文件为主；各块可在 execute 时按 fileName 覆盖 */
  primaryFileName?: string;
}

export function buildPdfBundledSkillManifests(): SkillManifest[] {
  const specs: Array<{ id: PdfPrePipelineSkillId; name: string; description: string }> = [
    {
      id: 'yueli-pdf-structural-analyst',
      name: 'PDF结构分析员',
      description: '分析 PDF 章节骨架与文档结构'
    },
    {
      id: 'yueli-pdf-summarizer',
      name: 'PDF摘要员',
      description: '生成 PDF 执行摘要'
    },
    {
      id: 'yueli-pdf-paraphraser',
      name: 'PDF转述员',
      description: '转述 PDF 核心论述'
    },
    {
      id: 'yueli-pdf-data-extractor',
      name: 'PDF数据抽取员',
      description: '抽取 PDF 中数字、日期与表格行'
    }
  ];

  return specs.map((s) => ({
    id: s.id,
    name: s.name,
    version: '1.0.0',
    author: 'Yueli Copilot',
    description: s.description,
    context_injection: { mode: 'pre_llm' as const },
    runtime: { type: 'prompt' as const },
    tags: ['pdf', 'attachment', 'pre_llm']
  }));
}

export function getPdfBundledManifestMap(): Map<string, SkillManifest> {
  const map = new Map<string, SkillManifest>();
  for (const m of buildPdfBundledSkillManifests()) {
    map.set(m.id, m);
  }
  return map;
}

/** 注册到 SkillExecutor + PluginManager（Mount 预检跳过） */
export async function registerPdfBundledSkillsInOrchestrator(orchestrator: CoreOrchestratorV2): Promise<void> {
  const skillExecutor = orchestrator.getSkillExecutor();
  const pluginManager = orchestrator.getPluginManager();

  for (const manifest of buildPdfBundledSkillManifests()) {
    skillExecutor.registerSkillFromManifest(manifest.id, manifest);

    if (!pluginManager.getSkill(manifest.id)) {
      await pluginManager.installSkill(manifest.id, {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        author: manifest.author,
        type: 'skill',
        dependencies: [],
        capabilities: [],
        permissions: [],
        configuration: {}
      });
    }

    const inst = pluginManager.getSkill(manifest.id);
    if (inst && !inst.enabled) {
      await pluginManager.enableSkill(manifest.id, { skipPreflight: true, manifest });
    }
  }
  devLog('[pdfOrchestrator] bundled PDF skills registered:', PDF_PRE_PIPELINE_SKILL_IDS.length);
}

export function isPdfPrePipelineSkillId(skillId: string): boolean {
  return (PDF_PRE_PIPELINE_SKILL_IDS as readonly string[]).includes(skillId);
}

/** 有 PDF 附件上下文时，将四 Skill 并入 skillsPrePipeline（pre_llm） */
export function mergePdfSkillsIntoPrePipeline(
  existingPrePipeline: string[],
  manifestMap: Map<string, SkillManifest | undefined>
): string[] {
  const pdfManifests = getPdfBundledManifestMap();
  for (const [id, m] of pdfManifests) {
    manifestMap.set(id, m);
  }
  const plan = buildSkillInjectionPlan([...PDF_PRE_PIPELINE_SKILL_IDS], manifestMap);
  return [...new Set([...plan.skillsPrePipeline, ...existingPrePipeline])];
}

/** 从编排器 skillResults 转为 PDF 管道角色产出 */
export function orchestratorPdfSkillResultsToRoleOutputs(
  skillResults: Record<string, { success?: boolean; result?: string } | undefined> | undefined
): PdfPipelineRoleOutput[] {
  if (!skillResults) return [];
  const out: PdfPipelineRoleOutput[] = [];
  for (const skillId of PDF_PRE_PIPELINE_SKILL_IDS) {
    const sr = skillResults[skillId];
    if (!sr || sr.success === false) continue;
    const roleId = SKILL_ID_TO_ROLE[skillId];
    const content = typeof sr.result === 'string' ? sr.result.trim() : '';
    if (!content) continue;
    out.push({
      roleId,
      displayName: ROLE_DISPLAY[roleId],
      content
    });
  }
  return out;
}

/** executeSkill 上下文：首块正文 + 文件名 */
export function buildPdfSkillExecutionVariables(
  ctx: PdfAttachmentContext,
  skillId: string
): { pdfText: string; fileName: string; userNote: string } {
  const block =
    ctx.blocks.find((b) => b.text?.trim() && !b.error) ?? ctx.blocks[0];
  const fileName =
    block?.name || ctx.primaryFileName || 'document.pdf';
  return {
    pdfText: block?.text?.trim() || ctx.userNote,
    fileName,
    userNote: ctx.userNote
  };
}
