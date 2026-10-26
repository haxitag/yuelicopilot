import type { PdfPipelineRoleOutput } from './types';
import {
  runDataExtractorRole,
  runParaphraserRole,
  runStructuralAnalystRole,
  runSummarizerRole
} from './pdfRolePipeline';

/** 四角色启发式处理并行执行（模拟多 SubAgent 人格） */
export async function runHeuristicRolesParallel(
  text: string,
  fileName: string
): Promise<PdfPipelineRoleOutput[]> {
  const [structural, summary, paraphrase, data] = await Promise.all([
    Promise.resolve(runStructuralAnalystRole(text, fileName)),
    Promise.resolve(runSummarizerRole(text, fileName)),
    Promise.resolve(runParaphraserRole(text, fileName)),
    Promise.resolve(runDataExtractorRole(text, fileName))
  ]);
  return [structural, summary, paraphrase, data];
}
