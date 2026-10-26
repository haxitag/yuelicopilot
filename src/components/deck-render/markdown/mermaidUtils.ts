import { devLog, devWarn } from '../../../utils/devConsole';

// Mermaid 渲染相关工具函数
/**
 * 安全处理中文字符和特殊符号，确保Mermaid能正确解析
 * 逆向思维：只处理 Mermaid 语法元素，其他内容保持原样
 */
export function sanitizeChineseCharacters(code: string): string {
  let sanitized = code;
  
  // 对于 sequenceDiagram、pie、journey、xychart-beta、heatmap、timeline 等特殊图表类型，完全保持原样
  if (sanitized.includes('sequenceDiagram') || 
      sanitized.includes('pie') || 
        sanitized.includes('journey') ||
        sanitized.includes('gantt') ||
      sanitized.includes('gitGraph') ||
      sanitized.includes('mindmap') ||
      sanitized.includes('xychart-beta') ||
      sanitized.includes('heatmap') ||
      sanitized.includes('timeline') ||
      sanitized.includes('quadrantChart')) {
    return sanitized;
  }
  
  // 对于 graph 和 flowchart，只处理明显的语法错误，不做内容转义
  if (sanitized.includes('graph') || sanitized.includes('flowchart')) {
    // 只修复明显的语法问题，不改变节点内容
    // 确保箭头语法正确
    sanitized = sanitized.replace(/\s*-->\s*/g, ' --> ');
    sanitized = sanitized.replace(/\s*---\s*/g, ' --- ');
    
    // 移除可能的多余空行
    sanitized = sanitized.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    return sanitized;
  }
  
  // 对于其他图表类型，也保持原样
  return sanitized;
}

/**
 * 简化Mermaid代码，移除复杂的特殊字符和格式
 */
export function simplifyMermaidCode(code: string): string {
  let simplified = code;
  simplified = simplified.replace(/(\w+)\["([^"]+)"\]/g, (match, nodeId, nodeText) => {
    const cleanText = nodeText.replace(/[^\u4e00-\u9fa5\w\s()（）]/g, '');
    return `${nodeId}[${cleanText}]`;
  });
  simplified = simplified.replace(/(\w+)\("([^"]+)"\)/g, (match, nodeId, nodeText) => {
    const cleanText = nodeText.replace(/[^\u4e00-\u9fa5\w\s()（）]/g, '');
    return `${nodeId}(${cleanText})`;
  });
  simplified = simplified.replace(/(\w+)\{"([^"]+)"\}/g, (match, nodeId, nodeText) => {
    const cleanText = nodeText.replace(/[^\u4e00-\u9fa5\w\s()（）]/g, '');
    return `${nodeId}{${cleanText}}`;
  });
  return simplified;
}

/**
 * 将Mermaid代码转换为纯ASCII版本，用英文替换中文
 */
export function convertToAsciiMermaid(code: string): string {
  let ascii = code;
  const chineseToEnglish: { [key: string]: string } = {
    '卫星互联网技术': 'Satellite Internet Technology',
    '低轨星座': 'LEO Constellation',
    '中轨星座': 'MEO Constellation',
    '高轨卫星': 'GEO Satellite',
    '延迟低': 'Low Latency',
    '覆盖全球': 'Global Coverage',
    '中等延迟': 'Medium Latency',
    '高延迟': 'High Latency',
    '技术': 'Technology',
    '系统': 'System',
    '网络': 'Network',
    '服务': 'Service',
    '数据': 'Data',
    '处理': 'Processing',
    '管理': 'Management',
    '分析': 'Analysis',
    '开始': 'Start',
    '结束': 'End',
    '流程': 'Process'
  };
  Object.entries(chineseToEnglish).forEach(([chinese, english]) => {
    ascii = ascii.replace(new RegExp(chinese, 'g'), english);
  });
  ascii = ascii.replace(/[\u4e00-\u9fa5]+/g, (match) => {
    return `Node${Math.abs(match.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 1000}`;
  });
  ascii = ascii.replace(/[（）]/g, (match) => match === '（' ? '(' : ')');
  ascii = ascii.replace(/[^\w\s\[\](){}>-]/g, '');
  return ascii;
}

/**
 * 智能修复Mermaid语法错误
 * 处理常见的语法问题和格式错误
 */
export function fixMermaidSyntax(code: string): string {
  let fixed = code;

  // 类型别名增强
  const typeAliases: Record<string, string> = {
    // 时序图
    sequencediagram: 'sequenceDiagram', sequence: 'sequenceDiagram', seq: 'sequenceDiagram', 'sequenceDiagram-v2': 'sequenceDiagram',
    // 甘特图
    ganttchart: 'gantt', 'gantt-chart': 'gantt',
    // 思维导图
    mindmap: 'mindmap', mind: 'mindmap', 'mind-map': 'mindmap', 'mindMap': 'mindmap',
    // 象限图
    quadrantchart: 'quadrantChart', 'quadrant-chart': 'quadrantChart', quadrant: 'quadrantChart',
    // 其他类型可继续补充
  };
  // 类型标准化
  let detectedType = '';
  for (const [alias, canonical] of Object.entries(typeAliases)) {
    if (fixed.toLowerCase().startsWith(alias)) {
      fixed = fixed.replace(new RegExp('^' + alias, 'i'), canonical);
      detectedType = canonical;
      break;
    }
  }
  if (!detectedType) {
    // fallback: 直接用首行类型
    const firstLine = fixed.split('\n')[0].toLowerCase();
    for (const [alias, canonical] of Object.entries(typeAliases)) {
      if (firstLine.includes(alias)) {
        detectedType = canonical;
        break;
      }
    }
  }
  // 1. 通用基础清理
  fixed = fixed.replace(/^[ \t]*(%%|\/\/|#).*$/gm, '');
  if (fixed.includes('data.json:')) {
    fixed = fixed.replace(/\n\s*data\.json\s*:\s*\n[\s\S]*$/g, '');
  }
  fixed = fixed.replace(/^\s*data\.json\s*:\s*$/gm, '');
  fixed = fixed.replace(/\n\s*\n/g, '\n');
  fixed = fixed.replace(/^(\s*)/gm, (match, spaces) => (spaces.length > 4 ? '  ' : spaces));
  // 修复多余右方括号: ["..."]] -> ["..."]（以及更长的]]...]）
  fixed = fixed.replace(/\["([^"\]]+)"\]\]+/g, '["$1"]');
  // 再次清理所有连续的多余右方括号到一个空格（防止贴合）
  fixed = fixed.replace(/\]{2,}(\w)/g, '] $1');
  // 节点内容的中文、特殊符号自动加引号包裹 - 修复引号闭合与内部方括号问题（跳过 [[subroutine]]）
  fixed = fixed.replace(/(\[[^\]]*[\u4e00-\u9fa5][^\]]*\])/g, (m) => {
    // 跳过 [[...]] 子程序节点，避免截断成 ["..."]] 残留
    if (m.startsWith('[[') || m.endsWith(']]')) {
      return m;
    }
    // 检查是否已经有完整的引号包裹
    if (/^\["[^"]*"\]$/.test(m)) {
      return m; // 已经正确包裹，直接返回
    }
    
    // 提取方括号内的内容
    const innerMatch = m.match(/\[([^\]]*)\]/);
    if (!innerMatch) return m;
    
    let inner = innerMatch[1];
    
    // 清理可能存在的不完整引号
    inner = inner.replace(/^["']+|["']+$/g, ''); // 移除开头和结尾的引号
    inner = inner.replace(/["']/g, ''); // 移除中间的引号，避免冲突
    // 替换内部方括号，避免被识别为子程序 [[...]] 或造成 SUBROUTINEEND
    inner = inner.replace(/\[/g, '（').replace(/\]/g, '）');
    
    // 重新包裹完整的引号
    return `["${inner}"]`;
  });
  // section/title 行的中文自动加引号
  fixed = fixed.replace(/^(\s*)(section|title)\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, key, val) => (/^".*"$/.test(val.trim()) ? match : `${spaces}${key} "${val.trim()}"`));

  // 2. 针对特定类型增强结构性修复
  // sequenceDiagram
  if (fixed.includes('sequenceDiagram')) {
    // participant 自动补全 - 增强版（支持中文/全角）
    const lines = fixed.split('\n');
    const participants = new Set<string>();
    const activatedParticipants = new Set<string>();
    const deactivatedParticipants = new Set<string>();
    
    lines.forEach(line => {
      const trimmed = line.trim();
      
      // 提取参与者名称的多种模式（支持中文、数字、下划线、连字符）
      const patterns = [
        /^([\u4e00-\u9fa5A-Za-z0-9_\-]+):/,                          // 名称: 消息
        /^(participant|actor)\s+([\u4e00-\u9fa5A-Za-z0-9_\-]+)/,     // participant 名称
        /^([\u4e00-\u9fa5A-Za-z0-9_\-]+)\s*->/,                      // 名称 -> 其他
        /([\u4e00-\u9fa5A-Za-z0-9_\-]+)\s*->\s*([\u4e00-\u9fa5A-Za-z0-9_\-]+)/, // 名称 -> 名称
        /activate\s+([^\s]+)/,                                         // activate 名称
        /deactivate\s+([^\s]+)/,                                       // deactivate 名称
        /note\s+over\s+([^\s]+)/,                                      // note over 名称
        /note\s+left\s+of\s+([^\s]+)/,                                // note left of 名称
        /note\s+right\s+of\s+([^\s]+)/                                // note right of 名称
      ];
      
      patterns.forEach(pattern => {
        const match = trimmed.match(pattern);
        if (match) {
          if (pattern.source.startsWith('^(participant|actor)')) {
            participants.add(match[2]);
          } else if (pattern.source.includes('->')) {
            // 双向箭头的情况
            if (match[2]) {
              participants.add(match[1]);
              participants.add(match[2]);
            } else {
              participants.add(match[1]);
            }
          } else {
            participants.add(match[1]);
          }
        }
      });
      
      // 跟踪激活/停用状态（支持中文）
      const activateMatch = trimmed.match(/activate\s+([^\s]+)/);
      if (activateMatch) {
        activatedParticipants.add(activateMatch[1]);
      }
      
      const deactivateMatch = trimmed.match(/deactivate\s+([^\s]+)/);
      if (deactivateMatch) {
        deactivatedParticipants.add(deactivateMatch[1]);
        // 如果尝试停用未激活的参与者，移除该行
        if (!activatedParticipants.has(deactivateMatch[1])) {
          devWarn(`[Mermaid修复] 尝试停用未激活的参与者: ${deactivateMatch[1]}`);
        }
      }
    });
    
    // 检查是否已声明 participant
    const hasParticipant = lines.some(l => l.trim().startsWith('participant ') || l.trim().startsWith('actor '));
    if (!hasParticipant && participants.size > 0) {
      // 在 sequenceDiagram 后插入所有 participant
      const idx = lines.findIndex(l => l.includes('sequenceDiagram'));
      if (idx >= 0) {
        lines.splice(idx + 1, 0, ...Array.from(participants).map(p => `    participant ${p}`));
        fixed = lines.join('\n');
      }
    }
    
    // 规范 participant/actor 行：
    // 1) 将同一行多个 participant/actor 拆成多行
    // 2) 移除名称尾部非法连字符/空白
    // 3) 限定名称字符集（中文/字母/数字/下划线/连字符）
    {
      const lines2 = fixed.split('\n');
      const rebuilt: string[] = [];
      const declPattern = /(participant|actor)\s+([^\s].*?)(?=\s+(?:participant|actor)\s+|$)/g;
      for (const raw of lines2) {
        const line = raw.trim();
        if (/^(participant|actor)\s+/.test(line) && (line.match(/\b(participant|actor)\b/g)?.length || 0) > 1) {
          // 拆分为多行
          let match: RegExpExecArray | null;
          while ((match = declPattern.exec(line)) !== null) {
            const role = match[1];
            let name = match[2].trim();
            name = name.replace(/[\-–—\s]+$/g, '');
            name = name.replace(/[^\u4e00-\u9fa5A-Za-z0-9_\-]/g, '');
            if (name) rebuilt.push(`${role} ${name}`);
          }
        } else if (/^(participant|actor)\s+/.test(line)) {
          const m = line.match(/^(participant|actor)\s+(.+)$/);
          if (m) {
            const role = m[1];
            let name = m[2].trim();
            name = name.replace(/[\-–—\s]+$/g, '');
            name = name.replace(/[^\u4e00-\u9fa5A-Za-z0-9_\-]/g, '');
            rebuilt.push(`${role} ${name}`);
          } else {
            rebuilt.push(raw);
          }
        } else {
          rebuilt.push(raw);
        }
      }
      fixed = rebuilt.join('\n');
    }

    // 修复常见 participant 语法（残留换行）
    fixed = fixed.replace(/participant\s*\n\s*([^\s]+)/g, 'participant $1');
    // 修复箭头
    fixed = fixed.replace(/--?>\s*>\s*(\w+)/g, '--> $1');
    // 补充 note over
    fixed = fixed.replace(/note\s+over\s+(\w+)/g, (m, p1) => `note over ${p1}`);
    // 补充 message（支持中文）
    fixed = fixed.replace(/^([^\s]+)\s*->\s*([^\s]+)/gm, (m, from, to) => `${from}->${to}`);
    
    // 移除对未激活参与者的停用指令（允许行尾注释）
    fixed = fixed.replace(/^\s*deactivate\s+([^\s]+)\s*(?:\s+%%.*|\s*\/\/.*|\s*#.*)?$/gm, (match, participant) => {
      if (!activatedParticipants.has(participant)) {
        devWarn(`[Mermaid修复] 移除对未激活参与者的停用指令: ${participant}`);
        return ''; // 移除这行
      }
      return match;
    });
    
    // 清理空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    return fixed.trim();
  }
  // gantt
  if (fixed.includes('gantt')) {
    // section 自动加引号
    fixed = fixed.replace(/^(\s*)section\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, val) => `${spaces}section "${val.trim()}"`);
    // title 自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // 修复任务行格式
    fixed = fixed.replace(/^(\s*)([^:]+):\s*([^,]+),\s*([^,]+),\s*([^,]+)/gm, (match, s, task, type, start, end) => `${s}${task.trim()}: ${type.trim()}, ${start.trim()}, ${end.trim()}`);
    return fixed.trim();
  }
  // mindmap
  if (fixed.includes('mindmap')) {
    // 标准化 mindmap 缩进，避免 "There can be only one root" 错误
    let changed = false;
    const lines = fixed.split('\n');
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
      }
      // root 至少两个空格缩进
      if (!/^\s{2,}root\s*\(\(/.test(lines[rootIdx])) {
        lines[rootIdx] = lines[rootIdx].replace(/^\s*/, '  ');
        changed = true;
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
      fixed = lines.join('\n');
    }
    return fixed.trim();
  }
  // pie图专门处理
  if (fixed.toLowerCase().includes('pie')) {
    // 确保以pie开头
    if (!fixed.trim().startsWith('pie')) {
      fixed = 'pie\n' + fixed;
    }
    
    // 修复标题格式
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, 
      (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    fixed = fixed.replace(/^(\s*)title\s+([^"\n]+)$/gm, 
      (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    
    // 修复数据行格式 - 处理各种可能的情况
    fixed = fixed.replace(/^(\s*)"([^"]+)"\s*:\s*(\d+)/gm, 
      (match, spaces, label, value) => `${spaces}"${label}" : ${value}`);
    
    // 修复没有引号的数据行
    fixed = fixed.replace(/^(\s*)([^":\n]+)\s*:\s*(\d+)/gm, 
      (match, spaces, label, value) => {
        const cleanLabel = label.trim().replace(/"/g, '');
        return `${spaces}"${cleanLabel}" : ${value}`;
      });
    
    // 清理可能导致解析错误的字符
    fixed = fixed.replace(/\s*--+\s*/g, ' '); // 移除破折号
    fixed = fixed.replace(/\^\s*/g, ''); // 移除^字符
    fixed = fixed.replace(/\btxt\b/g, ''); // 移除txt关键字
    fixed = fixed.replace(/\s+$$/gm, ''); // 移除行尾空白
    
    // 移除数据行后的多余内容
    fixed = fixed.replace(/^(\s*"[^"]+"\s*:\s*\d+)\s*[^\n\r]*$/gm, '$1');
    
    return fixed.trim();
  }
  
  // quadrantChart
  if (fixed.toLowerCase().includes('quadrantchart')) {
    // title 自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // 修复象限名
    fixed = fixed.replace(/^(\s*)([\u4e00-\u9fa5\w]+):/gm, (match, spaces, node) => `${spaces}${node}:`);
    return fixed.trim();
  }
  // graph/flowchart 结构性修复
  if (fixed.includes('graph') || fixed.includes('flowchart')) {
    // 1. subgraph 块缩进与 end 独立
    // end 必须独立成行
    fixed = fixed.replace(/\s*end\s*$/gm, '\nend');
    // subgraph 后面必须跟名称，自动补全
    fixed = fixed.replace(/subgraph\s*([\u4e00-\u9fa5\w]*)/g, (m, name) => `subgraph ${name || '子图'}`);
    // subgraph 内部缩进自动修正
    fixed = fixed.replace(/(subgraph [^\n]+\n)([\s\S]*?)(\nend)/g, (m, head, body, tail) => {
      const fixedBody = body.split('\n').map((line: string) => (line ? '  ' + line.trim() : '')).join('\n');
      return `${head}${fixedBody}${tail}`;
    });
    // 2. 决策节点 {} 自动修正
    fixed = fixed.replace(/\{\s*([\u4e00-\u9fa5\w]+)\s*\}/g, (m, label) => `{${label}}`);
    // 3. 分支 |标签| 语法自动修正
    fixed = fixed.replace(/--\|\s*([^|\n]+)\s*\|-->/g, (m, label) => `-->|${label}|-->`);
    // 4. 箭头、无向边等基础修复
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    fixed = fixed.replace(/\s*---\s*/g, ' --- ');
    // 5. 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    // 6) 保留 [[subroutine]]：防止被误包裹或替换
    // 不做任何内容改写，只确保不会落入后续加引号逻辑
    return fixed.trim();
  }
  // timeline 结构性修复
  if (fixed.toLowerCase().includes('timeline')) {
    // title 行自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5\w][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // 事件行补冒号、内容加引号
    fixed = fixed.replace(/^(\s*)([^:：\n]+)\s*[:：]\s*([^\n"]+)/gm, (match, spaces, event, content) => `${spaces}${event.trim()} : "${content.trim()}"`);
    // 兼容无冒号的事件行
    fixed = fixed.replace(/^(\s*)([\u4e00-\u9fa5\w]+)\s+([^\n"]+)/gm, (match, spaces, event, content) => `${spaces}${event.trim()} : "${content.trim()}"`);
    return fixed.trim();
  }
  // xychart-beta 结构性修复
  if (fixed.toLowerCase().includes('xychart-beta')) {
    // title 行自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5\w][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // x-axis 数据格式标准化
    fixed = fixed.replace(/^(\s*)x-axis\s+\[([^\]]+)\]/gm, (match, spaces, data) => `${spaces}x-axis [${data.trim()}]`);
    // y-axis 数据格式标准化
    fixed = fixed.replace(/^(\s*)y-axis\s+\[([^\]]+)\]/gm, (match, spaces, data) => `${spaces}y-axis [${data.trim()}]`);
    // bar 数据格式标准化
    fixed = fixed.replace(/^(\s*)bar\s+\[([^\]]+)\]/gm, (match, spaces, data) => `${spaces}bar [${data.trim()}]`);
    return fixed.trim();
  }
  // heatmap 结构性修复
  if (fixed.toLowerCase().includes('heatmap')) {
    // title 行自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5\w][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // xAxis 标签格式标准化
    fixed = fixed.replace(/^(\s*)xAxis\s+([^\n]+)/gm, (match, spaces, labels) => `${spaces}xAxis ${labels.trim()}`);
    // yAxis 标签格式标准化
    fixed = fixed.replace(/^(\s*)yAxis\s+([^\n]+)/gm, (match, spaces, labels) => `${spaces}yAxis ${labels.trim()}`);
    // data 数组格式标准化
    fixed = fixed.replace(/^(\s*)data\s+\[([^\]]+)\]/gm, (match, spaces, data) => `${spaces}data [${data.trim()}]`);
    return fixed.trim();
  }
  // gantt 结构性修复（增强版）
  if (fixed.includes('gantt')) {
    // title 自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    
    // dateFormat 格式标准化和修复
    fixed = fixed.replace(/^(\s*)dateFormat\s+([^\n]+)/gm, (match, spaces, format) => {
      const formatStr = format.trim();
      // 如果用户只指定了YYYY，自动扩展为YYYY-MM-DD
      if (formatStr === 'YYYY') {
        return `${spaces}dateFormat YYYY-MM-DD`;
      }
      return `${spaces}dateFormat ${formatStr}`;
    });
    
    // section 自动加引号
    fixed = fixed.replace(/^(\s*)section\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, val) => `${spaces}section "${val.trim()}"`);
    
    // 修复任务行格式 - 处理年份范围问题
    fixed = fixed.replace(/^(\s*)([^:]+):\s*([^,]+),\s*(\d{4})-(\d{4}),\s*([^,\n]+)/gm, (match, s, task, type, startYear, endYear, duration) => {
      // 将年份范围转换为具体日期
      const startDate = `${startYear}-01-01`;
      const endDate = `${endYear}-12-31`;
      return `${s}${task.trim()}: ${type.trim()}, ${startDate}, ${endDate}`;
    });
    
    // 修复任务行格式（任务名: 状态, 开始日期, 结束日期）
    fixed = fixed.replace(/^(\s*)([^:]+):\s*([^,]+),\s*([^,]+),\s*([^,]+)/gm, (match, s, task, type, start, end) => `${s}${task.trim()}: ${type.trim()}, ${start.trim()}, ${end.trim()}`);
    // 修复任务行格式（任务名: 状态, 开始日期, 结束日期）
    fixed = fixed.replace(/^(\s*)([^:]+)\s*:\s*([^,]+),\s*([^,]+),\s*([^,]+)/gm, (match, s, task, type, start, end) => `${s}${task.trim()}: ${type.trim()}, ${start.trim()}, ${end.trim()}`);
    
    return fixed.trim();
  }
  // quadrantChart 结构性修复
  if (fixed.toLowerCase().includes('quadrantchart')) {
    // title 自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // x-axis 定义格式标准化
    fixed = fixed.replace(/^(\s*)x-axis\s+"([^"]+)"\s*-->\s*"([^"]+)",\s*"([^"]+)"/gm, (match, spaces, label, low, high) => `${spaces}x-axis "${label}" --> "${low}", "${high}"`);
    // y-axis 定义格式标准化
    fixed = fixed.replace(/^(\s*)y-axis\s+"([^"]+)"\s*-->\s*"([^"]+)",\s*"([^"]+)"/gm, (match, spaces, label, low, high) => `${spaces}y-axis "${label}" --> "${low}", "${high}"`);
    // quadrant-1/2/3/4 数据格式标准化
    fixed = fixed.replace(/^(\s*)quadrant-(\d+)\s+([^\n]+)/gm, (match, spaces, num, data) => `${spaces}quadrant-${num} ${data.trim()}`);
    return fixed.trim();
  }
  // graph TD 分支结构性修复（增强版）
  if (fixed.includes('graph TD') || fixed.includes('graph LR')) {
    // 分支箭头 |标签| 语法标准化
    fixed = fixed.replace(/-->\s*\|\s*([^|\n]+)\s*\|\s*([^\n]+)/g, (m, label, target) => `-->|${label.trim()}| ${target.trim()}`);
    // 修复分支语法格式
    fixed = fixed.replace(/-->\s*([^|\n]+)\s*\|\s*([^|\n]+)/g, (m, target, label) => `-->|${label.trim()}| ${target.trim()}`);
    // 节点标签格式标准化
    fixed = fixed.replace(/\[([^\]]*[\u4e00-\u9fa5][^\]]*)\]/g, (m, content) => {
      // 检查是否已经有完整的引号包裹
      if (/^"[^"]*"$/.test(content)) {
        return m; // 已经正确包裹，直接返回
      }
      
      // 清理可能存在的不完整引号并重新包裹
      const cleanContent = content.replace(/^["']+|["']+$/g, '').replace(/["']/g, '');
      return `["${cleanContent}"]`;
    });
    // 决策节点 {} 自动修正
    fixed = fixed.replace(/\{\s*([\u4e00-\u9fa5\w]+)\s*\}/g, (m, label) => `{${label}}`);
    // 箭头、无向边等基础修复
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    fixed = fixed.replace(/\s*---\s*/g, ' --- ');
    // 修复相邻节点贴合：确保节点后与下一个节点之间有空格，防止如 "]]G -->" 贴合
    fixed = fixed.replace(/\]\](\w)/g, ']] $1');
    fixed = fixed.replace(/"\](\w)/g, '"] $1');
    fixed = fixed.replace(/\]([A-Za-z0-9_])/g, '] $1');
    // 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    return fixed.trim();
  }
  // graph LR/TD 样式修复（增强版）
  if (fixed.includes('graph LR') || fixed.includes('graph TD')) {
    // 修复 style 语法格式
    fixed = fixed.replace(/style\s+(\w+)\s+fill:([^,]+),stroke:([^\n]+)/g, (m, node, fill, stroke) => `style ${node} fill:${fill.trim()},stroke:${stroke.trim()}`);
    // 修复中文节点标签，清理内部方括号
    fixed = fixed.replace(/\[([^\]]*[\u4e00-\u9fa5][^\]]*)\]/g, (m, content) => {
      // 检查是否已经有完整的引号包裹
      if (/^"[^"]*"$/.test(content)) {
        return m; // 已经正确包裹，直接返回
      }
      
      // 清理可能存在的不完整引号并重新包裹
      const cleanContent = content
        .replace(/^["']+|["']+$/g, '')
        .replace(/["']/g, '')
        .replace(/\[/g, '（')
        .replace(/\]/g, '）');
      return `["${cleanContent}"]`;
    });
    // 修复决策节点中文标签
    fixed = fixed.replace(/\{\s*([\u4e00-\u9fa5\w]+)\s*\}/g, (m, label) => `{${label}}`);
    // 修复分支箭头语法
    fixed = fixed.replace(/-->\s*\|\s*([^|\n]+)\s*\|\s*([^\n]+)/g, (m, label, target) => `-->|${label.trim()}| ${target.trim()}`);
    // 修复箭头格式
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    // 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    return fixed.trim();
  }
  // timeline 结构性修复（增强版）
  if (fixed.toLowerCase().includes('timeline')) {
    // title 行自动加引号
    fixed = fixed.replace(/^(\s*)title\s+([^\n"]*[\u4e00-\u9fa5\w][^\n"]*)/gm, (match, spaces, val) => `${spaces}title "${val.trim()}"`);
    // 事件行补冒号、内容加引号
    fixed = fixed.replace(/^(\s*)([^:：\n]+)\s*[:：]\s*([^\n"]+)/gm, (match, spaces, event, content) => `${spaces}${event.trim()} : "${content.trim()}"`);
    // 兼容无冒号的事件行
    fixed = fixed.replace(/^(\s*)([\u4e00-\u9fa5\w]+)\s+([^\n"]+)/gm, (match, spaces, event, content) => `${spaces}${event.trim()} : "${content.trim()}"`);
    // 修复中文事件名称
    fixed = fixed.replace(/^(\s*)([^:：\n]+)\s*[:：]\s*([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, event, content) => `${spaces}${event.trim()} : "${content.trim()}"`);
    return fixed.trim();
  }
  // mindmap 结构性修复（增强版）
  if (fixed.toLowerCase().includes('mindmap')) {
    // 根节点自动加引号
    fixed = fixed.replace(/^(mindmap\s*\n)([^\n"]*[\u4e00-\u9fa5][^\n"]*)/m, (match, head, root) => `${head}"${root.trim()}"`);
    // 修复分支缩进和格式
    fixed = fixed.replace(/^(\s*)([\u4e00-\u9fa5\w]+):/gm, (match, spaces, node) => `${spaces}- ${node}`);
    // 修复中文节点名称
    fixed = fixed.replace(/^(\s*)-([^\n"]*[\u4e00-\u9fa5][^\n"]*)/gm, (match, spaces, node) => `${spaces}- "${node.trim()}"`);
    // 修复百分比和数值格式
    fixed = fixed.replace(/^(\s*)-([^:]+):\s*(\d+%)/gm, (match, spaces, node, percent) => `${spaces}- "${node.trim()}" : ${percent}`);
    return fixed.trim();
  }
  // graph TD 复杂分支修复（增强版）
  if (fixed.includes('graph TD')) {
    // 修复复杂分支语法 A --> B1 | B2，将其转换为多行
    const lines = fixed.split('\n');
    const fixedLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 检查是否包含复杂分支语法
      const branchMatch = line.match(/-->\s*([^\n]+)\s*\|\s*([^\n]+)/);
      if (branchMatch) {
        const [, target1, target2] = branchMatch;
        const source = line.split('-->')[0].trim();
        // 转换为两行
        fixedLines.push(`${source} --> ${target1.trim()}`);
        fixedLines.push(`${source} --> ${target2.trim()}`);
      } else {
        fixedLines.push(line);
      }
    }
    fixed = fixedLines.join('\n');
    
    // 修复节点标签格式：跳过 [[...]] 子程序语法，并清理内部方括号
    fixed = fixed.replace(/\[(?!\[)([^\]]*[\u4e00-\u9fa5][^\]]*)\]/g, (m, content) => {
      // 检查是否已经有完整的引号包裹
      if (/^"[^"]*"$/.test(content)) {
        return m; // 已经正确包裹，直接返回
      }
      
      // 清理可能存在的不完整引号并重新包裹
      const cleanContent = content
        .replace(/^["']+|["']+$/g, '')
        .replace(/["']/g, '')
        .replace(/\[/g, '（')
        .replace(/\]/g, '）');
      return `["${cleanContent}"]`;
    });
    // 修复箭头格式
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    // 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    return fixed.trim();
  }
  // graph LR 复杂分支修复（增强版）
  if (fixed.includes('graph LR')) {
    // 修复复杂分支语法 A --> B1 | B2，将其转换为多行
    const lines = fixed.split('\n');
    const fixedLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 检查是否包含复杂分支语法
      const branchMatch = line.match(/-->\s*([^\n]+)\s*\|\s*([^\n]+)/);
      if (branchMatch) {
        const [, target1, target2] = branchMatch;
        const source = line.split('-->')[0].trim();
        // 转换为两行
        fixedLines.push(`${source} --> ${target1.trim()}`);
        fixedLines.push(`${source} --> ${target2.trim()}`);
      } else {
        fixedLines.push(line);
      }
    }
    fixed = fixedLines.join('\n');
    
    // 修复 style 语法格式
    fixed = fixed.replace(/style\s+(\w+)\s+fill:([^,]+),stroke:([^\n]+)/g, (m, node, fill, stroke) => `style ${node} fill:${fill.trim()},stroke:${stroke.trim()}`);
    // 修复中文节点标签：跳过 [[...]]，并清理内部方括号
    fixed = fixed.replace(/\[(?!\[)([^\]]*[\u4e00-\u9fa5][^\]]*)\]/g, (m, content) => {
      // 检查是否已经有完整的引号包裹
      if (/^"[^"]*"$/.test(content)) {
        return m; // 已经正确包裹，直接返回
      }
      
      // 清理可能存在的不完整引号并重新包裹
      const cleanContent = content
        .replace(/^["']+|["']+$/g, '')
        .replace(/["']/g, '')
        .replace(/\[/g, '（')
        .replace(/\]/g, '）');
      return `["${cleanContent}"]`;
    });
    // 修复决策节点中文标签
    fixed = fixed.replace(/\{\s*([\u4e00-\u9fa5\w]+)\s*\}/g, (m, label) => `{${label}}`);
    // 修复分支箭头语法
    fixed = fixed.replace(/-->\s*\|\s*([^|\n]+)\s*\|\s*([^\n]+)/g, (m, label, target) => `-->|${label.trim()}| ${target.trim()}`);
    // 修复箭头格式
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    // 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    return fixed.trim();
  }
  // graph TB 修复（增强版）
  if (fixed.includes('graph TB')) {
    // 修复 subgraph 语法
    fixed = fixed.replace(/subgraph\s+([^\n]+)/g, (m, name) => `subgraph ${name.trim()}`);
    // 修复 subgraph 内部缩进
    fixed = fixed.replace(/(subgraph [^\n]+\n)([\s\S]*?)(\nend)/g, (m, head, body, tail) => {
      const fixedBody = body.split('\n').map((line: string) => (line ? '  ' + line.trim() : '')).join('\n');
      return `${head}${fixedBody}${tail}`;
    });
    // 修复中文节点标签
    fixed = fixed.replace(/\[([^\]]*[\u4e00-\u9fa5][^\]]*)\]/g, (m, content) => {
      // 检查是否已经有完整的引号包裹
      if (/^"[^"]*"$/.test(content)) {
        return m; // 已经正确包裹，直接返回
      }
      
      // 清理可能存在的不完整引号并重新包裹
      const cleanContent = content.replace(/^["']+|["']+$/g, '').replace(/["']/g, '');
      return `["${cleanContent}"]`;
    });
    // 修复分支箭头语法
    fixed = fixed.replace(/-->\s*\|\s*([^|\n]+)\s*\|\s*([^\n]+)/g, (m, label, target) => `-->|${label.trim()}| ${target.trim()}`);
    // 修复箭头格式
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    // 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    return fixed.trim();
  }
  // flowchart LR 修复（增强版）
  if (fixed.includes('flowchart LR')) {
    // 修复中文节点标签
    fixed = fixed.replace(/\[([^\]]*[\u4e00-\u9fa5][^\]]*)\]/g, (m, content) => {
      // 检查是否已经有完整的引号包裹
      if (/^"[^"]*"$/.test(content)) {
        return m; // 已经正确包裹，直接返回
      }
      
      // 清理可能存在的不完整引号并重新包裹
      const cleanContent = content.replace(/^["']+|["']+$/g, '').replace(/["']/g, '');
      return `["${cleanContent}"]`;
    });
    // 修复决策节点中文标签
    fixed = fixed.replace(/\{\s*([\u4e00-\u9fa5\w]+)\s*\}/g, (m, label) => `{${label}}`);
    // 修复分支箭头语法
    fixed = fixed.replace(/-->\s*\|\s*([^|\n]+)\s*\|\s*([^\n]+)/g, (m, label, target) => `-->|${label.trim()}| ${target.trim()}`);
    // 修复箭头格式
    fixed = fixed.replace(/(?<!-)\s*->\s*(?!>)/g, ' --> ');
    // 多余空行
    fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
    return fixed.trim();
  }
  // 其他类型保持原样
  return fixed.trim();
}

/**
 * 验证Mermaid语法的基本有效性
 */
export function validateMermaidSyntax(code: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 简化验证逻辑，只检查最基本的语法错误
  // 大部分验证工作交给Mermaid库自己处理
  
  // 检查是否有基本的图表类型声明
  const hasChartType = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|quadrantChart|timeline|xychart-beta|heatmap|zenuml|sankey)/m.test(code);
  
  if (!hasChartType) {
    // 不报错，只是警告，让Mermaid库自己处理
    devWarn('Mermaid代码可能缺少图表类型声明，但继续尝试渲染');
  }
  
  // 只检查明显的语法错误
  const lines = code.split('\n');
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    
    // 检查Journey图的错误语法
    if (code.includes('journey') && line.includes('-->')) {
      errors.push(`第${lineNum}行: Journey图不支持箭头语法，应使用 步骤名: 数字`);
    }
    
      // 检查Pie图的明显语法错误
  if (code.includes('pie')) {
    if (line.trim().startsWith('title') && line.trim().length <= 5) {
      errors.push(`第${lineNum}行: Pie图title语法错误，应为 "title 标题文本"`);
    }
    
    // 检查数据行格式
    const dataLinePattern = /^[^"]*[^:]*:\s*\d+/;
    if (dataLinePattern.test(line.trim()) && !line.includes('"')) {
      errors.push(`第${lineNum}行: Pie图数据行缺少引号，应为 "标签" : 数值`);
    }
    
    // 检查是否有多余的字符
    if (line.includes('--') || line.includes('^') || line.includes('txt')) {
      errors.push(`第${lineNum}行: Pie图包含无效字符，请移除多余的破折号、^或txt`);
    }
  }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * SVG bomb防护处理 - 统一处理所有SVG输出（终极版）
 */
export function sanitizeSVGForLayout(svg: string): string {
  if (!svg) return '';
  
  let safeSvg = svg;
  
  // 1. 标准化viewBox - 处理超大viewBox
  const viewBoxMatch = safeSvg.match(/viewBox="([^"]*)"/);
  if (viewBoxMatch) {
    const [, viewBox] = viewBoxMatch;
    const coords = viewBox.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (coords.length === 4) {
      const [x, y, width, height] = coords;
      // 如果宽高超过合理范围，进行智能缩放
      if (width > 1200 || height > 1000) {
        // 保持原始比例，但限制最大尺寸
        const scale = Math.min(1200 / width, 1000 / height, 1);
        const newWidth = Math.floor(width * scale);
        const newHeight = Math.floor(height * scale);
        safeSvg = safeSvg.replace(
          /viewBox="[^"]*"/,
          `viewBox="0 0 ${newWidth} ${newHeight}"`
        );
      }
    }
  } else {
    // 没有viewBox时添加更紧凑的viewBox
    safeSvg = safeSvg.replace(
      /<svg([^>]*)>/,
      '<svg$1 viewBox="0 0 600 400"'
    );
  }
  
  // 2. 强制尺寸限制 - 多层防护
  safeSvg = safeSvg
    // 移除所有固定尺寸属性
    .replace(/width="\d+(\.\d+)?(px|em|rem|%)*"/gi, '')
    .replace(/height="\d+(\.\d+)?(px|em|rem|%)*"/gi, '')
    .replace(/min-width="[^"]*"/gi, '')
    .replace(/min-height="[^"]*"/gi, '')
    .replace(/max-width="[^"]*"/gi, '')
    .replace(/max-height="[^"]*"/gi, '')
    // 移除style中的固定尺寸
    .replace(/style="([^"]*)width:\s*\d+[^;]*;?([^"]*)"/gi, 'style="$1$2"')
    .replace(/style="([^"]*)height:\s*\d+[^;]*;?([^"]*)"/gi, 'style="$1$2"')
    .replace(/style="([^"]*)min-width:\s*[^;]*;?([^"]*)"/gi, 'style="$1$2"')
    .replace(/style="([^"]*)min-height:\s*[^;]*;?([^"]*)"/gi, 'style="$1$2"')
    .replace(/style="([^"]*)max-width:\s*[^;]*;?([^"]*)"/gi, 'style="$1$2"')
    .replace(/style="([^"]*)max-height:\s*[^;]*;?([^"]*)"/gi, 'style="$1$2"');
  
  // 3. 处理内嵌样式和foreignObject
  safeSvg = safeSvg
    // 限制foreignObject尺寸
    .replace(/<foreignObject[^>]*>/gi, '<foreignObject style="max-width:100%;max-height:300px;overflow:auto;">')
    // 限制image尺寸
    .replace(/<image[^>]*>/gi, '<image style="max-width:100%;height:auto;"')
    // 限制text元素
    .replace(/<text[^>]*>/gi, '<text style="max-width:100%;word-wrap:break-word;"');
  
  // 4. 强制终极限制样式 - 移除固定高度限制，让内容自适应
  const finalStyle = 'max-width:100%!important;width:100%!important;height:auto!important;display:block!important;margin:0!important;padding:0!important;overflow:visible!important;';
  
  // 确保SVG标签包含正确的限制样式，不强制preserveAspectRatio
  if (safeSvg.includes('style=')) {
    safeSvg = safeSvg.replace(
      /style="([^"]*)"/,
      `style="${finalStyle}$1"`
    );
  } else {
    safeSvg = safeSvg.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="${finalStyle}" preserveAspectRatio="none">`
    );
  }
  
  // 5. 不添加额外的容器div，直接返回优化后的SVG
  
  return safeSvg;
}

/**
 * 测试语法修复功能
 */
export function testMermaidFixes() {
  devLog('=== Mermaid语法修复测试 ===');
  
  // 测试用例1: Journey图
  const journeyTest = `journey
       title 典型驾驶场景
       section 信息检索
           用户查询 --> 油门轻踩 --> 模型快速响应
       section 文档分析
           用户指令 --> 挡位切换到S档 --> 深度推理
       section 危险场景
           偏见内容生成 --> 紧急刹车 --> 上下文重置`;
           
  devLog('Journey图修复前:', journeyTest);
  devLog('Journey图修复后:', fixMermaidSyntax(journeyTest));
  
  // 测试用例2: Graph with comments
  const graphTest = `graph LR
    A[马来西亚运营公司] -->|技术许可费| B(Labuan控股公司)
    B -->|股息| C(开曼母公司)
    D[新加坡客户] -->|合同拆分| A
    D -->|知识产权付款| B
    
    subgraph 合规要点
        A -->|年营收30%| E[本地税收]  // 符合转移定价规则
        B -->|3%所得税| F[Labuan FSA]
        C -->|0%税率| G[离岸免税]
    end`;
    
  devLog('Graph图修复前:', graphTest);
  devLog('Graph图修复后:', fixMermaidSyntax(graphTest));
  
  // 测试用例3: 错误的决策节点语法
  const decisionTest = `graph LR
   A[边缘计算节点] -->{ B任务类型}
   B -->|简单任务| C[中心化调度]
   B -->|复杂任务| D[DAO自治小组]
   D --> E[智能合约仲裁]`;
   
  devLog('决策节点修复前:', decisionTest);
  devLog('决策节点修复后:', fixMermaidSyntax(decisionTest));
  
  // 测试用例4: Pie图语法错误
  const pieTest1 = `pie
       title 资源分配效率
       "基础任务" : 65
       "复杂推理" : 28
       "安全校验" : 7`;
       
  devLog('Pie图1修复前:', pieTest1);
  devLog('Pie图1修复后:', fixMermaidSyntax(pieTest1));
  
  const pieTest2 = `pie
    title算法管理权分配
    "平台（78%" : 78
    "开发者（15%）" : 15
    "监管（7%）" : 7`;
    
  devLog('Pie图2修复前:', pieTest2);
  devLog('Pie图2修复后:', fixMermaidSyntax(pieTest2));
  
  devLog('=== 测试完成 ===');
}

// 在开发环境下自动运行测试
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).testMermaidFixes = testMermaidFixes;
}

// 检查 SVG 字符串是否为 Mermaid 错误 SVG
export function isMermaidErrorSVG(svg: string): boolean {
  if (!svg) return false;
  // 检查典型错误 class 和文本
  return (
    svg.includes('class="error-icon"') ||
    svg.includes('class="error-text"') ||
    svg.includes('Syntax error in text') ||
    svg.includes('mermaid version') ||
    svg.includes('aria-roledescription="error"')
  );
}

/**
 * 分析是否为线性流程图（单向箭头，无分支合并）
 */
export function analyzeLinearFlow(code: string): { isLinear: boolean; nodeCount: number; hasBranches: boolean } {
  // 更强大的连接关系提取，支持多行格式和节点标签
  // 匹配 A --> B, A[label] --> B[label] 等格式
  const directConnections = code.match(/\w+(?:\[[^\]]*\])?\s*-->\s*\w+(?:\[[^\]]*\])?/g) || [];
  
  // 同时处理链式连接，如 A --> B --> C
  const chainConnections: string[] = [];
  const chainMatches = code.match(/\w+(?:\[[^\]]*\])?(?:\s*-->\s*\w+(?:\[[^\]]*\])?)+/g);
  if (chainMatches) {
    chainMatches.forEach(chain => {
      const nodes = chain.split(/\s*-->\s*/);
      for (let i = 0; i < nodes.length - 1; i++) {
        chainConnections.push(`${nodes[i]} --> ${nodes[i + 1]}`);
      }
    });
  }
  
  // 合并所有连接
  const allConnections = [...directConnections, ...chainConnections];
  
  // 检查条件分支（带标签的箭头）
  const conditionalConnections = code.match(/\w+\s*-->[\|\s]*[^-\n]*\s*\w+/g) || [];
  
  // 提取所有节点
  const allNodes = new Set<string>();
  const nodeOutgoing = new Map<string, number>(); // 每个节点的出度
  const nodeIncoming = new Map<string, number>(); // 每个节点的入度
  
  // 分析所有连接
  allConnections.forEach(conn => {
    const match = conn.match(/(\w+)(?:\[[^\]]*\])?\s*-->\s*(\w+)(?:\[[^\]]*\])?/);
    if (match) {
      const [, from, to] = match;
      allNodes.add(from);
      allNodes.add(to);
      
      nodeOutgoing.set(from, (nodeOutgoing.get(from) || 0) + 1);
      nodeIncoming.set(to, (nodeIncoming.get(to) || 0) + 1);
    }
  });
  
  // 检查是否有分支结构
  const hasBranches = conditionalConnections.length > 0 || 
                     code.includes('-->|') || 
                     code.includes('{') || // 决策节点
                     code.includes('((') || // 圆形节点
                     Array.from(nodeOutgoing.values()).some(count => count > 1); // 任何节点有多个输出
  
  const startNodes = Array.from(allNodes).filter(node => (nodeIncoming.get(node) || 0) === 0);
  const endNodes = Array.from(allNodes).filter(node => (nodeOutgoing.get(node) || 0) === 0);
  const middleNodes = Array.from(allNodes).filter(node => 
    (nodeIncoming.get(node) || 0) === 1 && (nodeOutgoing.get(node) || 0) === 1
  );
  
  // 调试信息（开发环境）
  devLog('Linear Flow Analysis:', {
    allConnections,
    allNodes: Array.from(allNodes),
    startNodes,
    endNodes,
    middleNodes,
    nodeOutgoing: Object.fromEntries(nodeOutgoing),
    nodeIncoming: Object.fromEntries(nodeIncoming),
    hasBranches
  });
  
  const isLinear = !hasBranches && 
                   startNodes.length === 1 && 
                   endNodes.length === 1 && 
                   (startNodes.length + middleNodes.length + endNodes.length) === allNodes.size &&
                   allNodes.size >= 3; // 至少3个节点才考虑线性优化
  
  return {
    isLinear,
    nodeCount: allNodes.size,
    hasBranches
  };
}

/**
 * 根据是否线性流程图判断返回方向
 */
export const  decideFlowChartDirection = (code: string): "TD" | "LR" => {
  const linearAnalysis = analyzeLinearFlow(code);
  if(linearAnalysis.isLinear){
    return "LR"
  }
  return "TD"
}

/**
 * 从代码中精准检测 mermaid 流程图方向（TD/TB/BT/RL/LR）
 * 1) 优先匹配首行的 graph/flowchart 声明
 * 2) 次优匹配独立的 direction 指令
 * 3) 若未声明，则返回 undefined（由上层决定默认/推断）
 */
export function detectFlowDirection(code: string): "TD" | "TB" | "BT" | "RL" | "LR" | undefined {
  if (!code) return undefined;
  const lines = code.split(/\n|\r\n?/);
  const first = (lines[0] || '').trim();
  const headerMatch = first.match(/^(graph|flowchart)\s+(TD|TB|BT|RL|LR)\b/i);
  if (headerMatch) return headerMatch[2].toUpperCase() as any;

  const dirLine = code.match(/\bdirection\s+(TD|TB|BT|RL|LR)\b/i);
  if (dirLine) return (dirLine[1] || '').toUpperCase() as any;
  return undefined;
}

/**
 * 轻量级类型检测，用于跨模块场景（不依赖 MermaidTypeProcessor）
 */
export function detectMermaidTypeSimple(code: string): string {
  const clean = (code || '').toLowerCase().trim();
  
  // 精确匹配首行类型声明
  const firstLine = clean.split('\n')[0].trim();
  
  if (firstLine === 'mindmap' || firstLine.startsWith('mindmap ')) return 'mindmap';
  if (firstLine === 'gantt' || firstLine.startsWith('gantt ')) return 'gantt';
  if (firstLine === 'sequencediagram' || firstLine.startsWith('sequencediagram ')) return 'sequence';
  if (firstLine === 'classdiagram' || firstLine.startsWith('classdiagram ')) return 'class';
  if (firstLine === 'statediagram' || firstLine.startsWith('statediagram ') || firstLine.startsWith('statediagram-v2')) return 'state';
  if (firstLine === 'pie' || firstLine.startsWith('pie ')) return 'pie';
  if (firstLine === 'journey' || firstLine.startsWith('journey ')) return 'journey';
  if (firstLine === 'gitgraph' || firstLine.startsWith('gitgraph ')) return 'gitgraph';
  if (firstLine === 'requirementdiagram' || firstLine.startsWith('requirementdiagram ')) return 'requirement';
  if (firstLine === 'quadrantchart' || firstLine.startsWith('quadrantchart ')) return 'quadrantChart';
  if (firstLine === 'timeline' || firstLine.startsWith('timeline ')) return 'timeline';
  if (firstLine === 'xychart-beta' || firstLine.startsWith('xychart-beta ')) return 'xychart-beta';
  if (firstLine === 'erdiagram' || firstLine.startsWith('erdiagram ')) return 'erDiagram';
  if (firstLine.startsWith('flowchart ') || firstLine.startsWith('graph ')) return 'flowchart';
  
  // 回退到包含匹配
  if (clean.includes('mindmap')) return 'mindmap';
  if (clean.includes('gantt')) return 'gantt';
  if (clean.includes('sequencediagram') || clean.includes('sequence')) return 'sequence';
  if (clean.includes('classdiagram')) return 'class';
  if (clean.includes('statediagram')) return 'state';
  if (clean.includes('pie')) return 'pie';
  if (clean.includes('journey')) return 'journey';
  if (clean.includes('gitgraph')) return 'gitgraph';
  if (clean.includes('requirementdiagram') || clean.includes('requirement')) return 'requirement';
  if (clean.includes('quadrantchart')) return 'quadrantChart';
  if (clean.includes('timeline')) return 'timeline';
  if (clean.includes('xychart-beta')) return 'xychart-beta';
  if (clean.includes('heatmap')) return 'heatmap';
  if (clean.includes('erdiagram')) return 'erDiagram';
  if (clean.includes('flowchart') || clean.includes('graph')) return 'flowchart';
  return 'flowchart';
}

/**
 * 测试所有 mermaid 类型的修复效果
 */
export function testAllMermaidFixes() {
  devLog('=== 测试所有 Mermaid 类型修复效果 ===');
  
  // 测试用例1: timeline
  const timelineTest = `timeline
title 迭代优化周期
每季度 : 模型再训练
每次谈判后 : 案例入库
半年 : 策略框架升级`;
  
  devLog('Timeline 修复前:', timelineTest);
  devLog('Timeline 修复后:', fixMermaidSyntax(timelineTest));
  
  // 测试用例2: gantt
  const ganttTest = `gantt
title 英伟达技术路线图
dateFormat YYYY-MM-DD
section GPU架构
Hopper             :done, (2023-07-01), (2023-12-31)
Blackwell          :active, (2024-07-01), (2025-12-31)
Rubin              :crit, (2026-07-01), (forever)`;
  
  devLog('Gantt 修复前:', ganttTest);
  devLog('Gantt 修复后:', fixMermaidSyntax(ganttTest));
  
  // 测试用例3: mindmap
  const mindmapTest = `mindmap
root((市场竞争力))
供应商议价能力
TSMC代工依赖度: 78%
封装技术替代方案: 2家
客户议价能力
云服务商集中采购: TOP5占比62%
游戏显卡渠道分散度`;
  
  devLog('Mindmap 修复前:', mindmapTest);
  devLog('Mindmap 修复后:', fixMermaidSyntax(mindmapTest));
  
  // 测试用例4: quadrantChart
  const quadrantTest = `quadrantChart
title 英伟达中国合作伙伴价值分布
x-axis "技术贡献度" --> "低", "高"
y-axis "市场占有率" --> "低", "高"
quadrant-1 阿里云, 腾讯云
quadrant-2 商汤科技, 字节跳动
quadrant-3 小鹏汽车, 蔚来
quadrant-4 华为昇腾, 寒武纪`;
  
  devLog('QuadrantChart 修复前:', quadrantTest);
  devLog('QuadrantChart 修复后:', fixMermaidSyntax(quadrantTest));
  
  // 测试用例5: xychart-beta
  const xychartTest = `xychart-beta
title 算力-功耗比对比(TOPS/W)
x-axis [Mobileye EyeQ6, 高通Ride2, 英伟达Orin]
y-axis [2.5, 4.3, 6.8]
bar [2.5, 4.3, 6.8]`;
  
  devLog('XYChart-beta 修复前:', xychartTest);
  devLog('XYChart-beta 修复后:', fixMermaidSyntax(xychartTest));
  
  // 测试用例6: heatmap
  const heatmapTest = `heatmap
title 成本影响因素敏感度
xAxis 工艺节点, 中介层尺寸, 堆叠层数
yAxis 成本变化率
data [30%, 15%, 45%], [25%, 60%, 10%], [40%, 20%, 30%]`;
  
  devLog('Heatmap 修复前:', heatmapTest);
  devLog('Heatmap 修复后:', fixMermaidSyntax(heatmapTest));
  
  // 测试用例7: graph TD 复杂分支
  const graphTDTest = `graph TD
A[Mobileye提出许可条件] --> B1[高通接受] | B2[高通拒绝]
B1 --> C1[双方达成协议]
B2 --> D1[高通反提条件] | D2[高通放弃]
D1 --> E1[双方达成协议]
D2 --> F1[谈判失败]
A --> G1[NVIDIA接受] | G2[NVIDIA拒绝]
G1 --> H1[三方达成协议]
G2 --> I1[NVIDIA反提条件] | I2[NVIDIA放弃]
I1 --> J1[三方达成协议]
I2 --> K1[谈判失败]`;
  
  devLog('Graph TD 复杂分支修复前:', graphTDTest);
  devLog('Graph TD 复杂分支修复后:', fixMermaidSyntax(graphTDTest));
  
  // 测试用例8: graph LR 复杂分支
  const graphLRTest = `graph LR
A[初始提案] --> B{对方类型?}
B -->|强硬型(30%)| C[可能诉讼]
B -->|合作型(70%)| D[愿意妥协]
C --> E[预期值: -120]
D --> F[预期值: +180]
style A fill:#f2f,stroke:#333
style E fill:#f3f,stroke:#333
style F fill:#f4f,stroke:#333`;
  
  devLog('Graph LR 复杂分支修复前:', graphLRTest);
  devLog('Graph LR 复杂分支修复后:', fixMermaidSyntax(graphLRTest));
  
  // 测试用例9: graph TB with subgraph
  const graphTBTest = `graph TB
subgraph 博弈网络增强
A[专利持有方] -->|许可费博弈| B[制造商]
A -->|专利池联动| C[联盟成员]
B -->|替代技术开发| D[竞争对手]
C -->|交叉授权| A
end`;
  
  devLog('Graph TB with subgraph 修复前:', graphTBTest);
  devLog('Graph TB with subgraph 修复后:', fixMermaidSyntax(graphTBTest));
  
  // 测试用例10: flowchart LR
  const flowchartLRTest = `flowchart LR
A[历史案例库] --> B(策略生成引擎)
C[实时市场数据] --> B
B --> D{策略评估模块}
D -->|最优策略| E[谈判执行界面]
D -->|反馈数据| F[模型优化循环]`;
  
  devLog('Flowchart LR 修复前:', flowchartLRTest);
  devLog('Flowchart LR 修复后:', fixMermaidSyntax(flowchartLRTest));
  
  devLog('=== 测试完成 ===');
}

// 在开发环境下自动运行测试
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).testAllMermaidFixes = testAllMermaidFixes;
}
