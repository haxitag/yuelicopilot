import { ChartType } from './MermaidTypes';

export interface ProcessingResult {
  success: boolean;
  code: string;
  errors: string[];
  warnings: string[];
}

/**
 * 图表类型处理器基类
 */
abstract class BaseTypeProcessor {
  abstract type: ChartType;
  abstract process(code: string): ProcessingResult;
  abstract validate(code: string): string[];
  
  protected cleanCode(code: string): string {
    return code
      .replace(/^[ \t]*(%%|\/\/|#).*$/gm, '') // 移除注释
      .replace(/\n\s*\n/g, '\n') // 移除多余空行
      .replace(/^(\s*)/gm, (match, spaces) => (spaces.length > 4 ? '  ' : spaces)) // 标准化缩进
      .trim();
  }
}

/**
 * 流程图处理器
 */
class FlowchartProcessor extends BaseTypeProcessor {
  type: ChartType = 'flowchart';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = cleanCode;
    
    // 修复箭头语法
    processed = processed.replace(/\s*-->\s*/g, ' --> ');
    processed = processed.replace(/\s*---\s*/g, ' --- ');
    
    // 修复节点标签 - 跳过 [[subroutine]]，仅对单括号 [label] 在需要时加引号
    processed = processed.replace(/\[[^\]]+\]/g, (m) => {
      // 保留 [[...]] 不处理
      if (m.startsWith("[[") && m.endsWith("]]")) return m;
      // 已经包含引号，或无中文/空格等特殊字符则不处理
      const inner = m.slice(1, -1);
      if (/^".*"$/.test(inner)) return m;
      if (!(/[\u4e00-\u9fa5\s"',;{}()]/.test(inner))) return m;
      return `["${inner}"]`;
    });
    
    // 修复方向声明（大小写不敏感；若声明存在则规范为大写）
    if (!/^(graph|flowchart)\s+(td|tb|bt|rl|lr)\b/i.test(processed)) {
      processed = processed.replace(/^(graph|flowchart)\b/i, '$1 TD');
    } else {
      processed = processed.replace(
        /^(graph|flowchart)\s+(td|tb|bt|rl|lr)\b/i,
        (m, g1, dir) => `${g1} ${String(dir).toUpperCase()}`
      );
    }
    
    return {
      success: true,
      code: processed,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    // 检查基本语法
    if (!code.match(/^(graph|flowchart)/)) {
      errors.push('缺少图表类型声明');
    }
    
    // 检查节点定义
    const nodeMatches = code.match(/\w+\s*[\[\(][^\]\)]*[\]\)]/g);
    if (!nodeMatches || nodeMatches.length === 0) {
      errors.push('缺少节点定义');
    }
    
    return errors;
  }
}

/**
 * 时序图处理器
 */
class SequenceProcessor extends BaseTypeProcessor {
  type: ChartType = 'sequence';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = cleanCode;
    
    // 确保类型声明正确
    if (!processed.startsWith('sequenceDiagram')) {
      processed = 'sequenceDiagram\n' + processed;
    }
    
    // 自动补全participant声明
    const lines = processed.split('\n');
    const participants = new Set<string>();
    
    lines.forEach(line => {
      const m1 = line.match(/^(\w+):/);
      const m2 = line.match(/^(participant|actor)\s+(\w+)/);
      const m3 = line.match(/^(\w+)\s*->/);
      
      if (m1) participants.add(m1[1]);
      if (m2) participants.add(m2[2]);
      if (m3) participants.add(m3[1]);
    });
    
    // 检查是否已声明participant
    const hasParticipant = lines.some(l => l.trim().startsWith('participant '));
    if (!hasParticipant && participants.size > 0) {
      const idx = lines.findIndex(l => l.includes('sequenceDiagram'));
      if (idx >= 0) {
        lines.splice(idx + 1, 0, ...Array.from(participants).map(p => `participant ${p}`));
        processed = lines.join('\n');
      }
    }
    
    // 修复箭头语法
    processed = processed.replace(/--?>\s*>\s*(\w+)/g, '--> $1');
    processed = processed.replace(/^(\w+)\s*->\s*(\w+)/gm, '$1->$2');
    
    return {
      success: true,
      code: processed,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    if (!code.includes('sequenceDiagram')) {
      errors.push('缺少sequenceDiagram声明');
    }
    
    const hasMessages = code.match(/\w+\s*--?>\s*\w+/);
    if (!hasMessages) {
      errors.push('缺少消息定义');
    }
    
    return errors;
  }
}

/**
 * 甘特图处理器
 */
class GanttProcessor extends BaseTypeProcessor {
  type: ChartType = 'gantt';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = 'gantt\n';
    
    // 提取标题
    const titleMatch = cleanCode.match(/title\s+(.+)/);
    if (titleMatch) {
      processed += `    title "${titleMatch[1].trim()}"\n`;
    }
    
    // 提取并修复dateFormat
    const dateFormatMatch = cleanCode.match(/dateFormat\s+(.+)/);
    if (dateFormatMatch) {
      let format = dateFormatMatch[1].trim();
      // 如果只指定了YYYY，自动扩展为YYYY-MM-DD
      if (format === 'YYYY') {
        format = 'YYYY-MM-DD';
        warnings.push('dateFormat已从YYYY自动扩展为YYYY-MM-DD以支持完整日期');
      }
      processed += `    dateFormat ${format}\n`;
    } else {
      // 如果没有指定dateFormat，添加默认格式
      processed += `    dateFormat YYYY-MM-DD\n`;
      warnings.push('添加了默认的dateFormat YYYY-MM-DD');
    }
    
    // 提取section和任务
    const lines = cleanCode.split('\n');
    lines.forEach(line => {
      const trimmedLine = line.trim();
      
      // 处理section
      const sectionMatch = trimmedLine.match(/section\s+(.+)/);
      if (sectionMatch) {
        processed += `    section "${sectionMatch[1].trim()}"\n`;
      }
      
      // 处理任务定义 - 增强版本，处理年份范围
      const taskMatch = trimmedLine.match(/^([^:]+):\s*(.+)/);
      if (taskMatch && !trimmedLine.includes('section') && !trimmedLine.includes('title') && !trimmedLine.includes('dateFormat')) {
        const [, task, params] = taskMatch;
        let processedParams = params.trim();
        
        // 处理年份范围格式：2023-2025 -> 2023-01-01, 2025-12-31
        const yearRangeMatch = processedParams.match(/(\d{4})-(\d{4})/);
        if (yearRangeMatch) {
          const startYear = yearRangeMatch[1];
          const endYear = yearRangeMatch[2];
          processedParams = processedParams.replace(
            /(\d{4})-(\d{4})/g, 
            `${startYear}-01-01, ${endYear}-12-31`
          );
          warnings.push(`年份范围 ${startYear}-${endYear} 已转换为具体日期`);
        }
        
        processed += `    "${task.trim()}" : ${processedParams}\n`;
      }
    });
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    if (!code.includes('gantt')) {
      errors.push('缺少gantt声明');
    }
    
    return errors;
  }
}

/**
 * 思维导图处理器 - 转换为流程图显示
 */
class MindmapProcessor extends BaseTypeProcessor {
  type: ChartType = 'mindmap'; // 正确映射到mindmap类型
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];

    // 不转换mindmap，直接返回原代码，让mermaid.js原生处理
    // 但先进行语法修复
    let fixedCode = cleanCode;
    
    // 应用mindmap语法修复逻辑
    if (fixedCode.includes('mindmap')) {
      // 标准化 mindmap 缩进，避免 "There can be only one root" 错误
      let changed = false;
      const lines = fixedCode.split('\n');
      const firstIdx = lines.findIndex(l => /^\s*mindmap\b/.test(l));
      if (firstIdx >= 0) {
        // 确保 root 存在
        let rootIdx = -1;
        for (let i = firstIdx + 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;
          if (/^\s*root\s*\(\(/.test(line)) { rootIdx = i; break; }
          // 遇到非空且不是 root，说明缺 root
          break;
        }
        if (rootIdx === -1) {
          lines.splice(firstIdx + 1, 0, '  root((中心主题))');
          rootIdx = firstIdx + 1;
          changed = true;
          warnings.push('mindmap 缺少 root 节点，已插入 `root((中心主题))`。');
        }
        // root 至少两个空格缩进
        if (!/^\s{2,}root\s*\(\(/.test(lines[rootIdx])) {
          lines[rootIdx] = lines[rootIdx].replace(/^\s*/, '  ');
          changed = true;
          warnings.push('已为 mindmap 的 root 节点补充标准缩进。');
        }
        // root 以下的行全部作为子节点：至少四个空格
        for (let i = rootIdx + 1; i < lines.length; i++) {
          const raw = lines[i];
          if (!raw.trim()) continue;
          if (/^\s*%%/.test(raw)) continue;
          if (/^\s*mindmap\b/.test(raw)) break; // 新的图或结束
          if (!/^\s{4,}/.test(raw)) {
            lines[i] = '    ' + raw.replace(/^\s*/, '');
            changed = true;
          }
        }
        if (changed) {
          warnings.push('已将 mindmap 的节点缩进标准化，避免多 root/无父节点错误。');
        }
        fixedCode = lines.join('\n');
      }
    }

    return {
      success: true,
      code: fixedCode,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasRoot = code.match(/root\(\([^)]+\)\)/);
    if (!hasRoot) {
      errors.push('缺少根节点定义');
    }
    
    return errors;
  }
}

/**
 * 饼图处理器
 */
class PieProcessor extends BaseTypeProcessor {
  type: ChartType = 'pie';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = cleanCode;
    
    // 确保类型声明正确
    if (!processed.startsWith('pie')) {
      processed = 'pie\n' + processed;
    }
    
    // 修复标题 - 更严格的处理
    processed = processed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, 
      (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    
    // 修复没有引号的标题
    processed = processed.replace(/^(\s*)title\s+([^"\n]+)$/gm, 
      (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    
    // 修复数据行 - 处理各种可能的格式
    processed = processed.replace(/^(\s*)"([^"]+)"\s*:\s*(\d+)/gm, 
      (match, spaces, label, value) => `${spaces}"${label}" : ${value}`);
    
    // 修复没有引号的数据行
    processed = processed.replace(/^(\s*)([^":\n]+)\s*:\s*(\d+)/gm, 
      (match, spaces, label, value) => {
        const cleanLabel = label.trim().replace(/"/g, ''); // 移除可能存在的引号
        return `${spaces}"${cleanLabel}" : ${value}`;
      });
    
    // 移除可能导致解析错误的多余字符
    processed = processed.replace(/^(\s*)"([^"]+)"\s*:\s*(\d+)\s*[^\n\r]*$/gm, 
      (match, spaces, label, value) => `${spaces}"${label}" : ${value}`);
    
    // 清理可能的格式问题
    processed = processed.replace(/\s*--+\s*/g, ' '); // 移除多余的破折号
    processed = processed.replace(/\^\s*/g, ''); // 移除可能的^字符
    processed = processed.replace(/\btxt\b/g, ''); // 移除可能的txt关键字
    
    return {
      success: true,
      code: processed,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    if (!code.includes('pie')) {
      errors.push('缺少pie声明');
    }
    
    const hasData = code.match(/"[^"]+"\s*:\s*\d+/);
    if (!hasData) {
      errors.push('缺少数据定义');
    }
    
    return errors;
  }
}

/**
 * 雷达图处理器 - 转换为饼图显示
 */
class RadarProcessor extends BaseTypeProcessor {
  type: ChartType = 'pie'; // 映射到pie类型
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = ['雷达图已转换为饼图显示'];
    
    let processed = 'pie\n';
    
    // 提取标题
    const titleMatch = cleanCode.match(/title\s+"?([^"\n]+)"?/);
    if (titleMatch) {
      processed += `title "${titleMatch[1].trim()}"\n`;
    }
    
    // 提取数据并转换为饼图格式
    const dataMatches = cleanCode.match(/"([^"]+)"\s*:\s*(\d+)/g);
    if (dataMatches) {
      dataMatches.forEach(match => {
        const [, label, value] = match.match(/"([^"]+)"\s*:\s*(\d+)/) || [];
        if (label && value) {
          processed += `"${label}" : ${value}\n`;
        }
      });
    }
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasData = code.match(/"([^"]+)"\s*:\s*(\d+)/);
    if (!hasData) {
      errors.push('缺少数据定义');
    }
    
    return errors;
  }
}

/**
 * 柱状图处理器 - 转换为流程图显示
 */
class BarProcessor extends BaseTypeProcessor {
  type: ChartType = 'flowchart'; // 映射到flowchart类型
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = ['柱状图已转换为流程图显示'];
    
    let processed = 'graph TD\n';
    
    // 提取标题
    const titleMatch = cleanCode.match(/title\s+"?([^"\n]+)"?/);
    if (titleMatch) {
      processed += `%% ${titleMatch[1].trim()}\n`;
    }
    
    // 提取数据并转换为流程图格式
    const dataMatches = cleanCode.match(/"([^"]+)"\s*:\s*(\d+)/g);
    if (dataMatches) {
      dataMatches.forEach((match, index) => {
        const [, label, value] = match.match(/"([^"]+)"\s*:\s*(\d+)/) || [];
        if (label && value) {
          const nodeId = `A${index + 1}`;
          processed += `${nodeId}["${label}: ${value}"]\n`;
          if (index > 0) {
            processed += `${nodeId} --> A${index}\n`;
          }
        }
      });
    }
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasData = code.match(/"([^"]+)"\s*:\s*(\d+)/);
    if (!hasData) {
      errors.push('缺少数据定义');
    }
    
    return errors;
  }
}

/**
 * 循环图处理器 - 转换为流程图显示
 */
class CycleProcessor extends BaseTypeProcessor {
  type: ChartType = 'flowchart'; // 映射到flowchart类型
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = ['循环图已转换为流程图显示'];
    
    let processed = 'graph LR\n';
    
    // 提取方向设置
    if (cleanCode.includes('direction LR')) {
      processed = 'graph LR\n';
    } else if (cleanCode.includes('direction TD')) {
      processed = 'graph TD\n';
    }
    
    // 提取节点和连接关系
    const lines = cleanCode.split('\n');
    const nodes = new Set<string>();
    const connections: string[] = [];
    
    lines.forEach(line => {
      const connectionMatch = line.match(/(\w+)\s*-->\s*(\w+)\s*:\s*(.+)/);
      if (connectionMatch) {
        const [, from, to, label] = connectionMatch;
        nodes.add(from);
        nodes.add(to);
        connections.push(`${from} -->|${label.trim()}| ${to}`);
      }
    });
    
    // 添加节点定义
    nodes.forEach(node => {
      processed += `${node}[${node}]\n`;
    });
    
    // 添加连接关系
    connections.forEach(conn => {
      processed += `${conn}\n`;
    });
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasConnections = code.match(/\w+\s*-->\s*\w+/);
    if (!hasConnections) {
      errors.push('缺少连接关系定义');
    }
    
    return errors;
  }
}

/**
 * Git图处理器 - 转换为流程图显示
 */
class GitGraphProcessor extends BaseTypeProcessor {
  type: ChartType = 'flowchart'; // 映射到flowchart类型
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = ['Git图已转换为流程图显示'];
    
    let processed = 'graph LR\n';
    
    // 提取commit和连接关系
    const lines = cleanCode.split('\n');
    const commits = new Set<string>();
    const connections: string[] = [];
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('commit')) {
        // 处理commit行
        const commitMatch = trimmedLine.match(/commit\s+(\w+)\s*-->\s*commit\s+(\w+)\s*:\s*(.+)/);
        if (commitMatch) {
          const [, from, to, message] = commitMatch;
          commits.add(from);
          commits.add(to);
          connections.push(`    ${from} -->|${message.trim()}| ${to}`);
        } else {
          // 单独的commit
          const singleCommitMatch = trimmedLine.match(/commit\s+(\w+)/);
          if (singleCommitMatch) {
            commits.add(singleCommitMatch[1]);
          }
        }
      }
    });
    
    // 添加commit节点
    commits.forEach(commit => {
      processed += `    ${commit}[${commit}]\n`;
    });
    
    // 添加连接关系
    connections.forEach(conn => {
      processed += `${conn}\n`;
    });
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasCommits = code.match(/commit\s+\w+/);
    if (!hasCommits) {
      errors.push('缺少commit定义');
    }
    
    return errors;
  }
}

/**
 * 类图处理器
 */
class ClassProcessor extends BaseTypeProcessor {
  type: ChartType = 'class';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = cleanCode;
    
    // 1) 确保第一行是 classDiagram（最小改动，不动原始内容顺序）
    if (!/^classDiagram\b/.test(processed)) {
      processed = 'classDiagram\n' + processed;
    }
    
    // 2) 修复常见的紧邻问题：`}\nclass` 之间缺少换行
    processed = processed.replace(/}\s*(?=class\s+\w+)/g, '}\n');
    
    // 3) 不做任何语法“自动纠正”（不删花括号、不添加可见性修饰符），仅做轻量清洗
    //    - 去除行首尾多余空白
    processed = processed
      .split('\n')
      .map(line => line.replace(/^[\t ]+|[\t ]+$/g, ''))
      .join('\n');
    
    return {
      success: true,
      code: processed,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    if (!code.includes('classDiagram')) {
      errors.push('缺少classDiagram声明');
    }
    
    const hasClasses = code.match(/class\s+\w+/);
    if (!hasClasses) {
      errors.push('缺少类定义');
    }
    
    return errors;
  }
}

/**
 * 序列流图处理器 - 转换为时序图显示
 */
class SequenceFlowProcessor extends BaseTypeProcessor {
  type: ChartType = 'sequence'; // 映射到sequence类型
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = ['序列流图已转换为时序图显示'];
    
    let processed = 'sequenceDiagram\n';
    
    // 提取参与者
    const participants = new Set<string>();
    const lines = cleanCode.split('\n');
    
    lines.forEach(line => {
      const connectionMatch = line.match(/(\w+)\s*-->\s*(\w+)\s*:\s*(.+)/);
      if (connectionMatch) {
        const [, from, to] = connectionMatch;
        participants.add(from);
        participants.add(to);
      }
    });
    
    // 添加参与者声明
    participants.forEach(participant => {
      processed += `participant ${participant}\n`;
    });
    
    // 添加消息
    lines.forEach(line => {
      const connectionMatch = line.match(/(\w+)\s*-->\s*(\w+)\s*:\s*(.+)/);
      if (connectionMatch) {
        const [, from, to, message] = connectionMatch;
        processed += `${from}->>${to}: ${message.trim()}\n`;
      }
    });
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasConnections = code.match(/\w+\s*-->\s*\w+/);
    if (!hasConnections) {
      errors.push('缺少连接关系定义');
    }
    
    return errors;
  }
}

/**
 * 状态图处理器
 */
class StateProcessor extends BaseTypeProcessor {
  type: ChartType = 'state';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = cleanCode;
    
    // 确保类型声明正确
    if (!processed.startsWith('stateDiagram')) {
      processed = 'stateDiagram-v2\n' + processed;
    }
    
    // 修复状态名
    processed = processed.replace(/^(\s*)(\w+)\s*:/gm, '$1state $2');
    
    return {
      success: true,
      code: processed,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    if (!code.includes('stateDiagram')) {
      errors.push('缺少stateDiagram声明');
    }
    
    const hasStates = code.match(/state\s+\w+/);
    if (!hasStates) {
      errors.push('缺少状态定义');
    }
    
    return errors;
  }
}

/**
 * 用户旅程图处理器
 */
class JourneyProcessor extends BaseTypeProcessor {
  type: ChartType = 'journey';
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = [];
    
    let processed = cleanCode;
    
    // 确保类型声明正确
    if (!processed.startsWith('journey')) {
      processed = 'journey\n' + processed;
    }
    
    // 修复标题
    processed = processed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, 
      (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    
    // 修复section
    processed = processed.replace(/^(\s*)section\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, 
      (match, spaces, val) => `${spaces}section "${val.trim()}"`);
    
    // 修复任务定义
    processed = processed.replace(/^(\s*)([^:]+):\s*(\d+):\s*([^\n]+)/gm, 
      (match, spaces, task, time, actor) => `${spaces}${task.trim()}: ${time}: ${actor.trim()}`);
    
    return {
      success: true,
      code: processed,
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    if (!code.includes('journey')) {
      errors.push('缺少journey声明');
    }
    
    const hasSections = code.match(/section\s+/);
    if (!hasSections) {
      errors.push('缺少section定义');
    }
    
    return errors;
  }
}

/**
 * 需求图处理器
 */
class RequirementProcessor extends BaseTypeProcessor {
  type: ChartType = 'flowchart'; // 映射到flowchart类型，因为mermaid可能不支持requirementDiagram
  
  process(code: string): ProcessingResult {
    const cleanCode = this.cleanCode(code);
    const errors: string[] = [];
    const warnings: string[] = ['需求图已转换为流程图显示'];
    
    let processed = 'graph TD\n';
    
    // 提取需求定义
    const lines = cleanCode.split('\n');
    const requirements: string[] = [];
    
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // 处理requirement定义
      const reqMatch = trimmedLine.match(/requirement\s+(\w+)\s*\{/);
      if (reqMatch) {
        const reqName = reqMatch[1];
        requirements.push(reqName);
        processed += `    ${reqName}["需求: ${reqName}"]\n`;
      }
      
      // 处理id和text
      const idMatch = trimmedLine.match(/id:\s*(.+)/);
      if (idMatch) {
        const id = idMatch[1].trim();
        processed += `    id_${index}["ID: ${id}"]\n`;
        if (requirements.length > 0) {
          processed += `    ${requirements[requirements.length - 1]} --> id_${index}\n`;
        }
      }
      
      const textMatch = trimmedLine.match(/text:\s*"([^"]+)"/);
      if (textMatch) {
        const text = textMatch[1];
        processed += `    text_${index}["${text}"]\n`;
        if (requirements.length > 0) {
          processed += `    ${requirements[requirements.length - 1]} --> text_${index}\n`;
        }
      }
    });
    
    return {
      success: true,
      code: processed.trim(),
      errors,
      warnings
    };
  }
  
  validate(code: string): string[] {
    const errors: string[] = [];
    
    const hasRequirements = code.match(/requirement\s+\w+/);
    if (!hasRequirements) {
      errors.push('缺少requirement定义');
    }
    
    return errors;
  }
}

/**
 * 类型处理器管理器
 */
export class MermaidTypeProcessor {
  private static processors: Map<ChartType, BaseTypeProcessor> = new Map([
    ['flowchart', new FlowchartProcessor()],
    ['sequence', new SequenceProcessor()],
    ['gantt', new GanttProcessor()],
    ['mindmap', new MindmapProcessor()],
    ['pie', new PieProcessor()],
    ['radar', new RadarProcessor()],
    ['bar', new BarProcessor()],
    ['cycle', new CycleProcessor()],
    ['gitgraph', new GitGraphProcessor()],
    ['class', new ClassProcessor()],
    ['state', new StateProcessor()],
    ['sequenceflow', new SequenceFlowProcessor()],
    ['journey', new JourneyProcessor()],
    ['requirement', new RequirementProcessor()]
  ]);
  
  /**
   * 检测图表类型
   */
  static detectType(code: string): ChartType {
    const cleanCode = code.toLowerCase().trim();
    const firstLine = cleanCode.split('\n')[0].trim();
    
    // 精确匹配首行类型声明（优先级高）
    if (firstLine === 'mindmap' || firstLine.startsWith('mindmap ')) return 'mindmap';
    if (firstLine === 'gantt' || firstLine.startsWith('gantt ')) return 'gantt';
    if (firstLine === 'sequencediagram' || firstLine.startsWith('sequencediagram ')) return 'sequence';
    if (firstLine === 'classdiagram' || firstLine.startsWith('classdiagram ')) return 'class';
    if (firstLine === 'statediagram' || firstLine.startsWith('statediagram ') || firstLine.startsWith('statediagram-v2')) return 'state';
    if (firstLine === 'pie' || firstLine.startsWith('pie ')) return 'pie';
    if (firstLine === 'journey' || firstLine.startsWith('journey ')) return 'journey';
    if (firstLine === 'gitgraph' || firstLine.startsWith('gitgraph ')) return 'gitgraph';
    if (firstLine.startsWith('flowchart ') || firstLine.startsWith('graph ')) return 'flowchart';
    
    // 包含匹配（优先级低）
    if (cleanCode.includes('mindmap')) return 'mindmap';
    if (cleanCode.includes('gantt')) return 'gantt';
    if (cleanCode.includes('sequenceflow')) return 'sequenceflow';
    if (cleanCode.includes('sequencediagram') || cleanCode.includes('sequence')) return 'sequence';
    if (cleanCode.includes('classdiagram')) return 'class';
    if (cleanCode.includes('statediagram')) return 'state';
    if (cleanCode.includes('pie')) return 'pie';
    if (cleanCode.includes('journey')) return 'journey';
    if (cleanCode.includes('gitgraph')) return 'gitgraph';
    if (cleanCode.includes('radar')) return 'radar';
    if (cleanCode.includes('bar')) return 'bar';
    if (cleanCode.includes('cyclediagram')) return 'cycle';
    if (cleanCode.includes('requirementdiagram') || cleanCode.includes('requirement')) return 'requirement';
    if (cleanCode.includes('flowchart') || cleanCode.includes('graph')) return 'flowchart';
    
    return 'flowchart'; // 默认类型
  }
  
  /**
   * 处理图表代码
   */
  static process(code: string): ProcessingResult {
    const type = this.detectType(code);
    const processor = this.processors.get(type);
    
    if (!processor) {
      return {
        success: false,
        code,
        errors: [`不支持的图表类型: ${type}`],
        warnings: []
      };
    }
    
    return processor.process(code);
  }
  
  /**
   * 验证图表代码
   */
  static validate(code: string): string[] {
    const type = this.detectType(code);
    const processor = this.processors.get(type);
    
    if (!processor) {
      return [`不支持的图表类型: ${type}`];
    }
    
    return processor.validate(code);
  }
  
  /**
   * 注册新的处理器
   */
  static registerProcessor(type: ChartType, processor: BaseTypeProcessor) {
    this.processors.set(type, processor);
  }
}
