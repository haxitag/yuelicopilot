import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { MermaidRendererProps, RenderResult, ChartAnalysis, ChartType } from './MermaidTypes';
import { MermaidSizeOptimizer } from './MermaidSizeOptimizer';
import { MermaidTypeProcessor } from './MermaidTypeProcessor';
import { detectFlowDirection, detectMermaidTypeSimple, fixMermaidSyntax } from './mermaidUtils';
import { useLayoutTransition } from '../contexts/layoutTransitionStub';
import { devDebug, devLog } from '../../../utils/devConsole';

const MermaidContainer = styled.div<{ $isLoading: boolean }>`
  position: relative;
  /* 外层容器不再强制100%宽，交给内层根据实际SVG宽度和父容器可用宽度动态设置 */
  width: auto;
  min-width: 100px;
  min-height: ${props => props.$isLoading ? '200px' : 'auto'};
  display: flex;
  justify-content: center;
  align-items: center;
  background: transparent;
  border-radius: 8px;
  overflow: visible;
  
  .mermaid-svg {
    max-width: 100%;
    height: auto;
    display: block;
  }
  
  .loading-spinner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #666;
    font-size: 14px;
  }
  
  .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #e53e3e;
    font-size: 14px;
    padding: 16px;
    border: 1px solid #fed7d7;
    border-radius: 8px;
    background: #fff5f5;
  }
  
  .warning-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #d69e2e;
    font-size: 12px;
    padding: 8px;
    border: 1px solid #fef5e7;
    border-radius: 4px;
    background: #fffbeb;
    margin-top: 8px;
  }
`;

const LoadingSpinner = () => (
  <div className="loading-spinner">
    <div>🔄 正在渲染图表...</div>
  </div>
);

// 按钮容器组件
const ButtonContainer: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = React.useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleOpenRenderer = () => {
    // 先复制代码到剪贴板
    navigator.clipboard.writeText(code).then(() => {
      // 打开新窗口
      const rendererUrl = '/transform-mermaid.html';
      window.open(rendererUrl, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
    }).catch(() => {
      // 如果复制失败，直接打开窗口
      const rendererUrl = '/transform-mermaid.html';
      window.open(rendererUrl, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
    });
  };
  
  return (
    <div
      style={{
        position: "absolute",
        right: 4,
        top: 4,
        zIndex: 100,
        display: "flex",
        gap: "8px",
        alignItems: "center"
      }}
    >
      <button
        onClick={handleCopy}
        style={{
          fontSize: 12,
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #d1d5db",
          background: copied ? "#e0f7fa" : "#ffffff",
          color: "#007bff",
          cursor: "pointer",
          transition: "all 0.2s ease",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          fontWeight: 500
        }}
        title="复制Mermaid源码"
      >
        {copied ? "已复制" : "复制"}
      </button>
      
      <button
        onClick={handleOpenRenderer}
        style={{
          fontSize: 12,
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #d1d5db",
          background: "#ffffff",
          color: "#007bff",
          cursor: "pointer",
          transition: "all 0.2s ease",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          fontWeight: 500
        }}
        title="打开渲染器"
      >
        渲染器
      </button>
    </div>
  );
};

// 下载按钮组件已移除，只保留复制功能

const ErrorDisplay = ({ error, code }: { error: string; code: string }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ position: "relative", margin: "8px 0" }}>
      <button
        onClick={handleCopy}
        style={{
          position: "absolute",
          right: 8,
          top: 8,
          zIndex: 2,
          fontSize: 12,
          padding: "2px 8px",
          borderRadius: 4,
          border: "1px solid #d1d5db",
          background: copied ? "#e0f7fa" : "#f6f8fa",
          color: "#007bff",
          cursor: "pointer"
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre
        style={{
          background: "#f6f8fa",
          padding: "16px",
          borderRadius: "6px",
          overflow: "auto",
          maxWidth: "100%",
          boxSizing: "border-box",
          border: "1px solid #e1e4e8",
          fontSize: "13px",
          lineHeight: "1.45",
          fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
          margin: 0
        }}
      >
        <code style={{ background: "none", padding: 0, fontSize: "inherit", color: "#24292e" }}>
          {code}
        </code>
      </pre>
    </div>
  );
};

const WarningDisplay = ({ warnings }: { warnings: string[] }) => (
  <div className="warning-container">
    <div>⚠️ 检测到以下警告:</div>
    <ul style={{ margin: '4px 0', paddingLeft: '16px' }}>
      {warnings.map((warning, index) => (
        <li key={index}>{warning}</li>
      ))}
    </ul>
  </div>
);

/**
 * 优化的Mermaid渲染器
 * 整合大小优化和类型隔离功能
 */
export const OptimizedMermaidRenderer: React.FC<MermaidRendererProps> = ({
  code,
  config,
  onRendered,
  onError,
  className,
  style
}) => {
  // 安全地获取布局过渡状态，如果上下文不存在则默认为false
  let isLayoutTransitioning = false;
  try {
    const layoutTransition = useLayoutTransition();
    isLayoutTransitioning = layoutTransition.isLayoutTransitioning;
  } catch (_err) {
    // 如果不在LayoutTransitionProvider内部，使用默认值false
    devDebug('OptimizedMermaidRenderer: LayoutTransitionContext not available, using default value');
  }
  
  const [result, setResult] = useState<RenderResult>({
    success: false,
    warnings: [],
    processingTime: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onRenderedRef = useRef(onRendered);
  const onErrorRef = useRef(onError);
  const [svgSize, setSvgSize] = useState<{ width?: number; height?: number }>({});

  // 更新回调引用
  useEffect(() => {
    onRenderedRef.current = onRendered;
    onErrorRef.current = onError;
  });

  // 分析图表特性
  const analyzeChart = useCallback((code: string): ChartAnalysis => {
    const cleanCode = code.toLowerCase().trim();
    
    // 检测图表类型 - 更严格的检测逻辑
    let type: ChartType = 'unknown';
    
    // 优先检测明确的图表类型声明
    if (cleanCode.startsWith('gantt') || cleanCode.includes('\ngantt')) type = 'gantt';
    else if (cleanCode.startsWith('sequencediagram') || cleanCode.includes('\nsequencediagram')) type = 'sequence';
    else if (cleanCode.startsWith('classdiagram') || cleanCode.includes('\nclassdiagram')) type = 'class';
    else if (cleanCode.startsWith('statediagram') || cleanCode.includes('\nstatediagram')) type = 'state';
    else if (cleanCode.startsWith('mindmap') || cleanCode.includes('\nmindmap')) type = 'mindmap';
    else if (cleanCode.startsWith('pie') || cleanCode.includes('\npie')) type = 'pie';
    else if (cleanCode.startsWith('journey') || cleanCode.includes('\njourney')) type = 'journey';
    else if (cleanCode.startsWith('gitgraph') || cleanCode.includes('\ngitgraph')) type = 'gitgraph';
    else if (cleanCode.startsWith('requirementdiagram') || cleanCode.includes('\nrequirementdiagram')) type = 'requirement';
    else if (cleanCode.startsWith('flowchart') || cleanCode.startsWith('graph') || 
             cleanCode.includes('\nflowchart') || cleanCode.includes('\ngraph')) type = 'flowchart';
    
    // 分析复杂度 - 改进节点计数逻辑
    const lines = code.split('\n').filter(line => line.trim());
    
    // 更准确的节点计数：提取所有节点定义和连接中的节点
    const nodeDefinitions = code.match(/\w+\s*[\[\(][^\]\)]*[\]\)]/g) || [];
    const connectionNodes = code.match(/\w+(?=\s*-->)|(?<=-->\s*)\w+/g) || [];
    
    // 从节点定义中提取节点ID
    const definedNodes = nodeDefinitions.map(match => {
      const nodeIdMatch = match.match(/^(\w+)/);
      return nodeIdMatch ? nodeIdMatch[1] : null;
    }).filter(Boolean);
    
    // 合并所有节点名称
    const allNodeNames = new Set([...definedNodes, ...connectionNodes]);
    const nodeCount = allNodeNames.size;
    
    // 计算复杂度 - 为简单图表提供更低的复杂度
    const textLength = code.replace(/[^\u4e00-\u9fa5\w\s]/g, '').length;
    let complexity = Math.min(10, Math.floor((nodeCount + textLength / 20) / 2));
    
    // 为简单流程图提供更低的复杂度
    if (type === 'flowchart' && nodeCount <= 8) {
      complexity = Math.max(1, Math.min(5, nodeCount / 2));
    }
    
    // 判断方向
    let orientation: 'horizontal' | 'vertical' | 'auto' = 'auto';
    let recommendedDirection: 'TD' | 'LR' | 'TB' | 'RL' = 'TD';
    let reason = '';
    
    if (type === 'sequence') {
      orientation = 'horizontal';
      recommendedDirection = 'LR';
      reason = '时序图适合横向布局';
    } else if (type === 'gantt') {
      orientation = 'horizontal';
      recommendedDirection = 'LR';
      reason = '甘特图适合横向布局';
    } else if (complexity > 7 || nodeCount > 15) {
      orientation = 'horizontal';
      recommendedDirection = 'LR';
      reason = '复杂图表适合横向布局';
    } else if (cleanCode.includes('lr') || cleanCode.includes('rl')) {
      orientation = 'horizontal';
      recommendedDirection = 'LR';
      reason = '用户指定横向布局';
    } else {
      orientation = 'vertical';
      recommendedDirection = 'TD';
      reason = '简单图表适合竖向布局';
    }
    
    return {
      type,
      orientation,
      complexity,
      nodeCount,
      textLength,
      recommendedDirection,
      reason
    };
  }, []);

  // 提前做一次快速合法性筛查：不符合任何已知类型则直接回退渲染，避免抛错
  try {
    const quick = analyzeChart(code);
    if (quick.type === 'unknown') {
      return (
        <div className={className} style={style}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>暂不支持的Mermaid类型，以下为原始代码：</div>
          <pre style={{
            background: '#f6f8fa', padding: 12, borderRadius: 6, overflow: 'auto',
            border: '1px solid #e1e4e8', fontSize: 13, lineHeight: 1.45,
            fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace', margin: 0
          }}>
            <code style={{ background: 'none', padding: 0, fontSize: 'inherit', color: '#24292e' }}>{code}</code>
          </pre>
        </div>
      );
    }
  } catch (_e) {
    // 分析失败同样回退
    return (
      <div className={className} style={style}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>暂不支持的Mermaid类型，以下为原始代码：</div>
        <pre style={{
          background: '#f6f8fa', padding: 12, borderRadius: 6, overflow: 'auto',
          border: '1px solid #e1e4e8', fontSize: 13, lineHeight: 1.45,
          fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace', margin: 0
        }}>
          <code style={{ background: 'none', padding: 0, fontSize: 'inherit', color: '#24292e' }}>{code}</code>
        </pre>
      </div>
    );
  }

  // 渲染图表
  const renderChart = useCallback(async (code: string) => {
    const startTime = Date.now();
    
    try {
      // 预处理：统一进行Mermaid语法修复，避免SUBROUTINEEND和sequence参与者错误
      const preprocessedCode = fixMermaidSyntax(code);
      // 1. 分析图表特性
      const chartAnalysis = analyzeChart(preprocessedCode);
      setAnalysis(chartAnalysis);
      
      // 调试信息
      devLog('🔍 Mermaid图表分析:', {
        type: chartAnalysis.type,
        nodeCount: chartAnalysis.nodeCount,
        complexity: chartAnalysis.complexity,
        orientation: chartAnalysis.orientation,
        reason: chartAnalysis.reason
      });
      
      // 2. 类型处理和验证
      const processingResult = MermaidTypeProcessor.process(preprocessedCode);
      
      // 调试信息
      devLog('🔧 Mermaid代码处理结果:', {
        originalCode: code,
        preprocessedCode,
        processedCode: processingResult.code,
        success: processingResult.success,
        errors: processingResult.errors,
        warnings: processingResult.warnings
      });
      
      if (!processingResult.success) {
        const error = processingResult.errors.join('; ');
        const result: RenderResult = {
          success: false,
          error,
          warnings: processingResult.warnings,
          processingTime: Date.now() - startTime
        };
        setResult(result);
        onErrorRef.current?.(error);
        return;
      }
      
      // 3. 获取容器宽度用于大小优化
      const containerWidth = containerRef.current?.offsetWidth;
      
      // 4. 生成优化配置
      const sizeConfig = MermaidSizeOptimizer.optimizeConfig(chartAnalysis, containerWidth);
      const mermaidConfig = MermaidSizeOptimizer.generateMermaidConfig(sizeConfig, chartAnalysis.type);
      
      // 5. 初始化Mermaid
      const mermaid = (await import('mermaid')).default;
      // 兼容类型差异：此处不限制主题枚举，按运行时配置初始化
      mermaid.initialize(mermaidConfig as any);
      
      // 6. 渲染图表
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Gantt图表特殊处理
      let renderCode = processingResult.code;
      if (chartAnalysis.type === 'gantt') {
        devLog('📅 检测到Gantt图表，应用特殊优化');
        
        // 检查并修复常见的Gantt语法问题
        if (renderCode.includes('dateFormat YYYY')) {
          renderCode = renderCode.replace(/dateFormat YYYY/g, 'dateFormat YYYY-MM-DD');
          devLog('📅 自动修复dateFormat从YYYY到YYYY-MM-DD');
        }
        
        // 修复年份范围格式
        renderCode = renderCode.replace(/(\d{4})-(\d{4})/g, (match, startYear, endYear) => {
          devLog(`📅 修复年份范围: ${startYear}-${endYear} -> ${startYear}-01-01, ${endYear}-12-31`);
          return `${startYear}-01-01, ${endYear}-12-31`;
        });
        
        // 为Gantt图表添加最小尺寸注释
        renderCode = renderCode + '\n%% 设置最小尺寸\n%% 最小宽度: 800px\n%% 最小高度: 400px';
      }
      
      devLog('🔧 最终渲染代码:', renderCode);
      const renderResult = await mermaid.render(id, renderCode);
      
      // 7. 检查渲染结果
      if (!renderResult?.svg) {
        throw new Error('渲染结果为空');
      }
      
      // 8. 优化SVG
      let optimizedSvg = MermaidSizeOptimizer.optimizeSVG(renderResult.svg, sizeConfig, chartAnalysis.type);
      if (optimizedSvg && typeof optimizedSvg === 'string') {
        // 解析SVG原始尺寸（viewBox 或 width/height），用于动态宽度/滚动策略
        let naturalW: number | undefined;
        let naturalH: number | undefined;
        try {
          const vbMatch = optimizedSvg.match(/viewBox=\"[^\"]*\"/i);
          if (vbMatch) {
            const nums = vbMatch[0].match(/[-\d\.]+/g);
            if (nums && nums.length >= 4) {
              naturalW = parseFloat(nums[2]);
              naturalH = parseFloat(nums[3]);
            }
          }
          if (!naturalW || !naturalH) {
            const wM = optimizedSvg.match(/\swidth=\"(\d+(?:\.\d+)?)(px)?\"/i);
            const hM = optimizedSvg.match(/\sheight=\"(\d+(?:\.\d+)?)(px)?\"/i);
            if (wM) naturalW = parseFloat(wM[1]);
            if (hM) naturalH = parseFloat(hM[1]);
          }
        } catch {}

        // 智能宽度策略：根据图表类型和尺寸特征决定显示模式
        const alwaysWideScroll = chartAnalysis.type === 'gantt' || chartAnalysis.type === 'sequence' || chartAnalysis.type === 'journey';
        let preferWideScroll = alwaysWideScroll;
        
        // 对于其他图表，只有在明确过窄时才使用横向滚动
        if (!preferWideScroll && naturalW && naturalH) {
          const minVisual = chartAnalysis.type === 'mindmap' ? 200 : 120;
          // 使用固定的800px作为参考宽度，避免动态父容器宽度计算
          const referenceWidth = 800;
          const scaledHeight = referenceWidth * (naturalH / naturalW);
          if (scaledHeight < minVisual && naturalW > referenceWidth) {
            preferWideScroll = true;
          }
        }
        
        // 设置最大宽度限制，防止页面布局破坏
        const maxWidthLimit = 750; // 最大1200px，避免过度横向扩展，保持页面布局稳定
        if (preferWideScroll && naturalW && naturalW > maxWidthLimit) {
          // 如果原始宽度超过限制，使用限制宽度并允许横向滚动
          naturalW = maxWidthLimit;
        }

                // 注入样式
        if (preferWideScroll && naturalW) {
          // 使用限制后的宽度，防止页面布局破坏
          const finalWidth = Math.min(naturalW, maxWidthLimit);
          if (!/style=\"[^\"]*width:/i.test(optimizedSvg)) {
            optimizedSvg = optimizedSvg.replace(
              /<svg(\s+)/i,
              `<svg style="width:${finalWidth}px;height:auto;max-width:${maxWidthLimit}px" preserveAspectRatio="xMidYMid meet" $1`
            );
          } else {
            optimizedSvg = optimizedSvg.replace(/width:\s*[^;\"]+/i, `width:${finalWidth}px`)
                                   .replace(/height:\s*100%/i, 'height:auto');
            if (!/preserveAspectRatio=/i.test(optimizedSvg)) {
              optimizedSvg = optimizedSvg.replace(/<svg(\s+)/i, '<svg preserveAspectRatio="xMidYMid meet" $1');
            }
            // 确保有最大宽度限制
            if (!/max-width:/i.test(optimizedSvg)) {
              optimizedSvg = optimizedSvg.replace(/<svg(\s+)/i, `<svg style="${optimizedSvg.match(/style="([^"]*)"/)?.[1] || ''};max-width:${maxWidthLimit}px" $1`);
            }
          }
        } else {
          // 常规：占满容器宽度，保持height:auto
          if (!/style=\"[^\"]*width:\s*100%/i.test(optimizedSvg)) {
            optimizedSvg = optimizedSvg.replace(
              /<svg(\s+)/i,
              '<svg style="width:100%;height:auto" preserveAspectRatio="xMidYMid meet" $1'
            );
          } else {
            optimizedSvg = optimizedSvg.replace(/height:\s*100%/i, 'height:auto');
            if (!/preserveAspectRatio=/i.test(optimizedSvg)) {
              optimizedSvg = optimizedSvg.replace(/<svg(\s+)/i, '<svg preserveAspectRatio="xMidYMid meet" $1');
            }
          }
        }

        setSvgSize({ width: naturalW, height: naturalH });
      }
      
      // 9. 清理DOM元素
      const elements = document.querySelectorAll(`[id^="${id}"]`);
      elements.forEach(el => el.remove());
      
      const finalResult: RenderResult = {
        success: true,
        svg: optimizedSvg,
        warnings: [...processingResult.warnings, ...processingResult.errors],
        processingTime: Date.now() - startTime
      };
      
      setResult(finalResult);
      onRenderedRef.current?.(finalResult);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      const result: RenderResult = {
        success: false,
        error: errorMessage,
        warnings: [],
        processingTime: Date.now() - startTime
      };
      setResult(result);
      onErrorRef.current?.(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [analyzeChart]);

  // 监听代码变化
  useEffect(() => {
    if (!code?.trim()) {
      setResult({
        success: false,
        error: '代码为空',
        warnings: [],
        processingTime: 0
      });
      setIsLoading(false);
      return;
    }
    
    // 验证是否为有效的Mermaid代码
    const isValidMermaidCode = (code: string): boolean => {
      const trimmedCode = code.trim();
      
      // 检查是否包含Mermaid图表类型标识
      const mermaidTypes = [
        'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
        'gantt', 'pie', 'journey', 'gitgraph', 'mindmap', 'timeline',
        'quadrantChart', 'erDiagram', 'requirementDiagram'
      ];
      
      const hasMermaidType = mermaidTypes.some(type => 
        trimmedCode.toLowerCase().includes(type.toLowerCase())
      );
      
      // 检查是否包含基本的图表结构（节点、连接等）
      const hasBasicStructure = trimmedCode.includes('-->') || 
                               trimmedCode.includes('---') || 
                               trimmedCode.includes('[') || 
                               trimmedCode.includes('(') ||
                               trimmedCode.includes('title') ||
                               trimmedCode.includes('section');
      
      return hasMermaidType || hasBasicStructure;
    };
    
    if (!isValidMermaidCode(code)) {
      setResult({
        success: false,
        error: '不是有效的Mermaid图表代码',
        warnings: ['请检查代码是否包含正确的Mermaid语法'],
        processingTime: 0
      });
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    renderChart(code);
  }, [code, renderChart]);

  // 监听容器大小变化 - 稳定的宽度计算策略避免反馈循环
  useEffect(() => {
    if (!containerRef.current) return;
    
    let resizeTimer: NodeJS.Timeout | null = null;
    let lastParentWidth = 0;
    let isInternalResize = false; // 标记是否为内部宽度调整导致的resize
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      
      // 如果正在布局过渡中，暂停重新渲染以避免抖动
      if (isLayoutTransitioning) {
        return;
      }
      
      // 如果是内部宽度调整导致的resize，忽略
      if (isInternalResize) {
        isInternalResize = false;
        return;
      }
      
      // 获取父容器宽度而不是当前容器宽度，避免自引用
      const parentElement = containerRef.current?.parentElement;
      if (!parentElement) return;
      
      const currentParentWidth = parentElement.clientWidth;
      
      // 只有父容器宽度变化超过阈值时才重新渲染
      if (Math.abs(currentParentWidth - lastParentWidth) < 20) return;
      
      // 防抖处理：延迟执行，避免频繁重渲染
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      
      resizeTimer = setTimeout(() => {
        // 再次检查是否正在过渡中
        if (isLayoutTransitioning) {
          return;
        }
        
        if (code?.trim()) {
          lastParentWidth = currentParentWidth;
          isInternalResize = true; // 标记即将进行内部调整
          renderChart(code);
        }
      }, 300); // 增加防抖延迟到300ms
    });
    
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
    };
  }, [code, renderChart, isLayoutTransitioning]);

  return (
    <MermaidContainer
      ref={containerRef}
      $isLoading={isLoading}
      className={className}
      style={style}
    >
      {isLoading && <LoadingSpinner />}
      
      {!isLoading && !result.success && result.error && (
        <ErrorDisplay error={result.error} code={code} />
      )}
      
      {!isLoading && result.success && result.svg && (() => {
        const effectiveType = analysis?.type || detectMermaidTypeSimple(code);
        const dir = detectFlowDirection(result.svg) || detectFlowDirection(code) || (analysis?.orientation === 'horizontal' ? 'LR' : 'TD');
        const isHorizontal = dir === 'LR' || dir === 'RL' || analysis?.orientation === 'horizontal';
        
        // 简化宽度计算策略，避免反馈循环
        const naturalW = svgSize.width && svgSize.width > 0 ? svgSize.width : undefined;
        const naturalH = svgSize.height && svgSize.height > 0 ? svgSize.height : undefined;

        // 智能宽度策略：根据图表类型和尺寸特征决定显示模式
        const alwaysWideScroll = effectiveType === 'gantt' || effectiveType === 'sequence' || effectiveType === 'journey';
        
        // 对于其他图表，只有在明确过窄时才使用横向滚动
        const preferWideScroll = alwaysWideScroll || (() => {
          if (!naturalW || !naturalH) return false;
          const minVisual = effectiveType === 'mindmap' ? 200 : 120;
          // 使用固定的800px作为参考宽度，避免动态计算
          const referenceWidth = 800;
          const scaledHeight = referenceWidth * (naturalH / naturalW);
          return scaledHeight < minVisual && naturalW > referenceWidth;
        })();
        
        // 设置最大宽度限制，防止页面布局破坏
        const maxWidthLimit = 1200; // 最大1200px，避免过度横向扩展，保持页面布局稳定
        const limitedWidth = naturalW && naturalW > maxWidthLimit ? maxWidthLimit : naturalW;
        const resolveAspect = (type?: string, d?: string): string | undefined => {
          const dirH = d === 'LR' || d === 'RL';
          switch (type) {
            case 'sequence':
              return dirH ? '16 / 9' : '4 / 3';
            case 'gantt':
            case 'journey':
            case 'timeline':
            case 'gitgraph':
              return '16 / 9';
            case 'pie':
            case 'radar':
              return '1 / 1';
            case 'class':
            case 'state':
              return dirH ? '16 / 9' : '9 / 16';
            case 'mindmap':
              return dirH ? '16 / 9' : '9 / 16';
            case 'flowchart':
            default:
              // 对于流程图，根据方向和节点数量动态调整
              return dirH ? '16 / 9' : '9 / 16';
          }
        };
        const aspect = resolveAspect(effectiveType as any, dir as any);
        return (
          <div
            className={`mermaid-svg ${effectiveType === 'gantt' ? 'mermaid-gantt' : ''}`}
            style={{
              position: 'relative',
              display: 'block',
              /* 智能宽度策略：横向滚动模式使用限制宽度，否则使用响应式 */
              width: preferWideScroll ? (limitedWidth ? `${limitedWidth}px` : 'auto') : 'auto',
              maxWidth: preferWideScroll ? `${maxWidthLimit}px` : '86%',
              minWidth: '100px',
              margin: '8px 0',
              /* 滚动策略：横向滚动模式允许水平滚动，否则限制容器 */
              overflowX: preferWideScroll ? 'auto' : 'hidden',
              overflowY: 'auto',
              minHeight: '60px',
              maxHeight: (() => {
                if (preferWideScroll) return undefined as any;
                if (effectiveType === 'mindmap') return isHorizontal ? '300px' : '700px';
                return isHorizontal ? '150px' : '500px';
              })(),
              height: 'auto',
              ...(effectiveType === 'gantt' ? {
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '12px',
                background: '#ffffff'
              } : {})
            }}
          >
            <div
              dangerouslySetInnerHTML={{ __html: result.svg }}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                /* 让内部SVG在限制高度下可滚动查看超出部分 */
                overflow: 'visible'
              }}
            />
          </div>
        );
      })()}
      
      {!isLoading && result.success && result.svg && (
        <ButtonContainer code={code} />
      )}
      
      {!isLoading && result.warnings.length > 0 && (
        <WarningDisplay warnings={result.warnings} />
      )}
      
      {analysis && (
        <div style={{ 
          position: 'absolute', 
          top: '40px', 
          right: '4px', 
          fontSize: '10px', 
          color: '#999',
          background: 'rgba(255,255,255,0.8)',
          padding: '2px 4px',
          borderRadius: '4px'
        }}>
          {analysis.type} | {analysis.complexity}/10 | {analysis.nodeCount}节点
        </div>
      )}
    </MermaidContainer>
  );
};
