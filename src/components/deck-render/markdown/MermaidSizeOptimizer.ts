import { ChartAnalysis } from './MermaidTypes';
import { devLog } from '../../../utils/devConsole';

export interface SizeConfig {
  width?: number;
  height?: number;
  padding: number;
  nodeSpacing: number;
  rankSpacing: number;
  fontSize: number;
  useMaxWidth: boolean;
}

export interface ChartTypeConfig {
  flowchart: SizeConfig;
  sequence: SizeConfig;
  gantt: SizeConfig;
  mindmap: SizeConfig;
  pie: SizeConfig;
  journey: SizeConfig;
  gitgraph: SizeConfig;
  class: SizeConfig;
  state: SizeConfig;
  [key: string]: SizeConfig;
}

/**
 * 智能大小优化器
 * 根据图表类型、复杂度、方向动态调整配置
 */
export class MermaidSizeOptimizer {
  private static readonly BASE_CONFIGS: ChartTypeConfig = {
    flowchart: {
      padding: 4,
      nodeSpacing: 15,
      rankSpacing: 20,
      fontSize: 12,
      useMaxWidth: true
    },
    sequence: {
      padding: 6,
      nodeSpacing: 20,
      rankSpacing: 30,
      fontSize: 13,
      useMaxWidth: true
    },
    gantt: {
      padding: 15,
      nodeSpacing: 25,
      rankSpacing: 35,
      fontSize: 14,
      useMaxWidth: true
    },
    mindmap: {
      padding: 8,
      nodeSpacing: 25,
      rankSpacing: 30,
      fontSize: 13,
      useMaxWidth: true
    },
    pie: {
      padding: 8,
      nodeSpacing: 20,
      rankSpacing: 25,
      fontSize: 13,
      useMaxWidth: true
    },
    journey: {
      padding: 10,
      nodeSpacing: 25,
      rankSpacing: 35,
      fontSize: 13,
      useMaxWidth: true
    },
    gitgraph: {
      padding: 8,
      nodeSpacing: 20,
      rankSpacing: 30,
      fontSize: 12,
      useMaxWidth: true
    },
    class: {
      padding: 10,
      nodeSpacing: 25,
      rankSpacing: 35,
      fontSize: 13,
      useMaxWidth: true
    },
    state: {
      padding: 8,
      nodeSpacing: 20,
      rankSpacing: 30,
      fontSize: 13,
      useMaxWidth: true
    }
  };

  /**
   * 根据图表分析结果生成优化配置（改进版本：借鉴beautiful-mermaid的精确排版算法）
   */
  static optimizeConfig(analysis: ChartAnalysis, containerWidth?: number): SizeConfig {
    const baseConfig = this.BASE_CONFIGS[analysis.type] || this.BASE_CONFIGS.flowchart;
    
    // 响应式布局：根据容器宽度动态调整（借鉴beautiful-mermaid）
    let responsivePadding = baseConfig.padding;
    let responsiveNodeSpacing = baseConfig.nodeSpacing;
    let responsiveRankSpacing = baseConfig.rankSpacing;
    
    if (containerWidth) {
      // 小屏幕：更紧凑的布局
      if (containerWidth < 600) {
        responsivePadding = Math.max(2, baseConfig.padding * 0.5);
        responsiveNodeSpacing = Math.max(8, baseConfig.nodeSpacing * 0.6);
        responsiveRankSpacing = Math.max(12, baseConfig.rankSpacing * 0.6);
      }
      // 中等屏幕：标准布局
      else if (containerWidth < 1200) {
        responsivePadding = baseConfig.padding;
        responsiveNodeSpacing = baseConfig.nodeSpacing;
        responsiveRankSpacing = baseConfig.rankSpacing;
      }
      // 大屏幕：更宽松的布局
      else {
        responsivePadding = baseConfig.padding * 1.2;
        responsiveNodeSpacing = baseConfig.nodeSpacing * 1.2;
        responsiveRankSpacing = baseConfig.rankSpacing * 1.2;
      }
    }
    
    // 为简单图表提供更激进的优化
    if (analysis.nodeCount <= 8 && analysis.complexity <= 3) {
      let simpleConfig;
      
      switch (analysis.type) {
        case 'flowchart':
          simpleConfig = {
            ...baseConfig,
            padding: Math.max(2, responsivePadding * 0.5),
            nodeSpacing: Math.max(10, responsiveNodeSpacing * 0.7),
            rankSpacing: Math.max(15, responsiveRankSpacing * 0.7),
            fontSize: 11,
            useMaxWidth: true
          };
          break;
        case 'pie':
          simpleConfig = {
            ...baseConfig,
            padding: 4,
            nodeSpacing: 12,
            rankSpacing: 15,
            fontSize: 12,
            useMaxWidth: true
          };
          break;
        case 'gantt':
          simpleConfig = {
            ...baseConfig,
            padding: 12,
            nodeSpacing: 25,
            rankSpacing: 30,
            fontSize: 14,
            useMaxWidth: true
          };
          break;
        case 'mindmap':
          simpleConfig = {
            ...baseConfig,
            padding: 6,
            nodeSpacing: 20,
            rankSpacing: 25,
            fontSize: 12,
            useMaxWidth: true
          };
          break;
        default:
          simpleConfig = {
            ...baseConfig,
            padding: Math.max(2, baseConfig.padding * 0.6),
            nodeSpacing: Math.max(10, baseConfig.nodeSpacing * 0.7),
            rankSpacing: Math.max(15, baseConfig.rankSpacing * 0.7),
            fontSize: Math.max(11, baseConfig.fontSize - 1),
            useMaxWidth: true
          };
      }
      
      devLog('🎯 应用简单图表优化配置:', {
        type: analysis.type,
        nodeCount: analysis.nodeCount,
        complexity: analysis.complexity,
        config: simpleConfig
      });
      
      return simpleConfig;
    }
    
    // 根据复杂度调整
    const complexityFactor = Math.max(0.5, Math.min(2.0, 1 + (analysis.complexity - 5) * 0.1));
    
    // 根据节点数量调整 - 为简单图表提供更紧凑的配置
    const nodeFactor = analysis.nodeCount <= 6 ? 0.7 : Math.max(0.6, Math.min(1.5, 1 - (analysis.nodeCount - 10) * 0.02));
    
    // 根据方向调整
    const orientationFactor = analysis.orientation === 'horizontal' ? 0.8 : 1.2;
    
    // 根据容器宽度调整
    const containerFactor = containerWidth ? Math.min(1.5, Math.max(0.7, containerWidth / 800)) : 1.0;
    
    const finalFactor = complexityFactor * nodeFactor * orientationFactor * containerFactor;
    
    return {
      ...baseConfig,
      padding: Math.round(responsivePadding * finalFactor),
      nodeSpacing: Math.round(responsiveNodeSpacing * finalFactor),
      rankSpacing: Math.round(responsiveRankSpacing * finalFactor),
      fontSize: Math.round(baseConfig.fontSize * finalFactor),
      useMaxWidth: true
    };
  }

  /**
   * 生成Mermaid初始化配置
   */
  static generateMermaidConfig(sizeConfig: SizeConfig, chartType: string) {
    const baseConfig = {
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      fontFamily: 'Arial, sans-serif',
      fontSize: sizeConfig.fontSize,
      themeVariables: {
        // 主色调 - 深蓝色（logo主色）
        primaryColor: '#1890ff',
        primaryTextColor: '#000000',
        primaryBorderColor: '#1890ff',
        lineColor: '#1890ff',
        
        // 渐变蓝色系列（logo渐变条）
        cScale0: '#e6f7ff',  // 最浅蓝
        cScale1: '#bae7ff',  // 浅蓝
        cScale2: '#91d5ff',  // 中浅蓝
        cScale3: '#69c0ff',  // 中蓝
        cScale4: '#40a9ff',  // 中深蓝
        cScale5: '#1890ff',  // 深蓝（主色）
        
        // 饼图颜色
        pie1: '#1890ff',
        pie2: '#40a9ff',
        pie3: '#69c0ff',
        pie4: '#91d5ff',
        pie5: '#bae7ff',
        
        // 背景和次要颜色
        secondaryColor: '#f0f8ff',
        tertiaryColor: '#e6f7ff',
        background: 'transparent',
        mainBkg: 'transparent',
        secondBkg: '#fafafa',
        tertiaryBkg: '#f5f5f5',
        
        // 文字颜色
        textColor: '#000000',
        nodeTextColor: '#000000',
        actorTextColor: '#000000',
        taskTextColor: '#000000',
        
        // 思维导图颜色
        mindmapClass1: '#1890ff',
        mindmapClass2: '#40a9ff',
        mindmapClass3: '#69c0ff',
        mindmapClass4: '#91d5ff',
        mindmapClass5: '#bae7ff',
        
        // 其他元素
        sectionBkgColor: '#f0f8ff',
        altSectionBkgColor: '#ffffff',
        gridColor: '#e8e8e8',
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        
        // 线条粗细设置
        lineWidth: 0.5,
        strokeWidth: 0.5
      }
    };

    // 根据图表类型添加特定配置
    const typeSpecificConfig = this.getTypeSpecificConfig(chartType, sizeConfig);
    
    const finalConfig = {
      ...baseConfig,
      ...typeSpecificConfig
    };
    
    devLog('⚙️ 生成Mermaid配置:', {
      chartType,
      sizeConfig,
      finalConfig: {
        fontSize: finalConfig.fontSize,
        flowchart: finalConfig.flowchart,
        theme: finalConfig.theme
      }
    });
    
    return finalConfig;
  }

  /**
   * 获取特定图表类型的配置
   */
  private static getTypeSpecificConfig(chartType: string, sizeConfig: SizeConfig) {
    switch (chartType) {
      case 'flowchart':
        return {
          flowchart: {
            useMaxWidth: sizeConfig.useMaxWidth,
            htmlLabels: true,
            curve: 'basis' as const,
            padding: sizeConfig.padding,
            nodeSpacing: sizeConfig.nodeSpacing,
            rankSpacing: sizeConfig.rankSpacing,
            // 设置线条粗细为0.5
            lineWidth: 0.5
          }
        };
      
      case 'sequence':
        return {
          sequence: {
            useMaxWidth: sizeConfig.useMaxWidth,
            diagramMarginX: sizeConfig.padding * 2,
            diagramMarginY: sizeConfig.padding,
            actorMargin: sizeConfig.nodeSpacing * 1.5,
            width: sizeConfig.nodeSpacing * 2,
            height: sizeConfig.nodeSpacing,
            boxMargin: sizeConfig.padding * 0.5,
            boxTextMargin: sizeConfig.padding * 0.25,
            noteMargin: sizeConfig.padding * 0.5,
            messageMargin: sizeConfig.rankSpacing,
            // 设置线条粗细为0.5
            lineWidth: 0.5
          }
        };
      
      case 'gantt':
        return {
          gantt: {
            useMaxWidth: true, // 强制使用最大宽度限制
            leftPadding: sizeConfig.padding * 4,
            rightPadding: sizeConfig.padding * 3,
            topPadding: sizeConfig.padding * 3,
            bottomPadding: sizeConfig.padding * 3,
            // 设置线条粗细为0.5
            lineWidth: 0.5,
            // Gantt特定配置
            fontSize: sizeConfig.fontSize,
            sectionFontSize: sizeConfig.fontSize + 2,
            numberSectionStyles: 4,
            axisFormat: '%Y-%m-%d',
            tickInterval: '1day',
            // 确保Gantt图表有足够的显示空间
            width: 800,
            height: 400
          }
        };
      
      default:
        return {};
    }
  }

  /**
   * 优化SVG响应式属性
   */
  static optimizeSVG(svg: string, sizeConfig: SizeConfig, chartType?: string): string {
    // 根据图表类型设置最佳的高宽比
    const getAspectRatio = (type?: string) => {
      switch (type) {
        case 'flowchart':
        case 'graph':
          return { width: '100%', height: 'auto', viewBox: '0 0 800 600' }; // 4:3
        case 'mindmap':
          return { width: '100%', height: 'auto', viewBox: '0 0 900 700' }; // 9:7
        case 'gantt':
          return { width: '100%', height: 'auto', viewBox: '0 0 1000 400' }; // 5:2
        case 'pie':
          return { width: '100%', height: 'auto', viewBox: '0 0 600 600' }; // 1:1
        case 'sequence':
        case 'sequenceflow':
          return { width: '100%', height: 'auto', viewBox: '0 0 800 500' }; // 8:5
        case 'journey':
          return { width: '100%', height: 'auto', viewBox: '0 0 900 600' }; // 3:2
        case 'radar':
          return { width: '100%', height: 'auto', viewBox: '0 0 700 700' }; // 1:1
        case 'bar':
          return { width: '100%', height: 'auto', viewBox: '0 0 800 500' }; // 8:5
        case 'cycle':
          return { width: '100%', height: 'auto', viewBox: '0 0 800 600' }; // 4:3
        case 'gitgraph':
          return { width: '100%', height: 'auto', viewBox: '0 0 800 600' }; // 4:3
        case 'class':
          return { width: '100%', height: 'auto', viewBox: '0 0 900 700' }; // 9:7
        case 'state':
          return { width: '100%', height: 'auto', viewBox: '0 0 800 600' }; // 4:3
        default:
          return { width: '100%', height: 'auto', viewBox: '0 0 800 600' }; // 默认4:3
      }
    };
    
    const aspectRatio = getAspectRatio(chartType);
    
    devLog('📐 应用86%宽度和最佳比例:', {
      chartType,
      aspectRatio,
      fontSize: sizeConfig.fontSize
    });
    
    let optimizedSvg = svg.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width:${aspectRatio.width};height:${aspectRatio.height};font-size:${sizeConfig.fontSize}px;" preserveAspectRatio="xMidYMid meet" viewBox="${aspectRatio.viewBox}">`
    );
    
    // Gantt图表特殊优化
    if (chartType === 'gantt') {
      devLog('📅 应用Gantt图表SVG优化');
      
      // 进一步优化Gantt图表的内部元素
      optimizedSvg = optimizedSvg.replace(
        /<text([^>]*font-size=")([^"]*)(")/g,
        (match, prefix, fontSize, suffix) => {
          const currentSize = parseInt(fontSize) || 12;
          const newSize = Math.max(currentSize, 12); // 降低最小字体大小
          return `${prefix}${newSize}${suffix}`;
        }
      );
    }
    
    return optimizedSvg;
  }
}
