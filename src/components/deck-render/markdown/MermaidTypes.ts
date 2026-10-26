export type ChartType = 
  | 'flowchart' 
  | 'sequence' 
  | 'gantt' 
  | 'mindmap' 
  | 'pie' 
  | 'journey' 
  | 'gitgraph' 
  | 'class' 
  | 'state'
  | 'radar'
  | 'bar'
  | 'cycle'
  | 'sequenceflow'
  | 'requirement'
  | 'timeline'
  | 'quadrantChart'
  | 'erDiagram'
  | 'unknown';

export interface ChartAnalysis {
  type: ChartType;
  orientation: 'horizontal' | 'vertical' | 'auto';
  complexity: number;
  nodeCount: number;
  textLength: number;
  recommendedDirection: 'TD' | 'LR' | 'TB' | 'RL';
  reason: string;
}

export interface MermaidConfig {
  startOnLoad: boolean;
  theme: 'base' | 'default' | 'dark' | 'forest' | 'neutral' | 'null' | string;
  securityLevel: string;
  fontFamily: string;
  fontSize: number;
  themeVariables: {
    primaryColor: string;
    primaryTextColor: string;
    primaryBorderColor: string;
    lineColor: string;
    secondaryColor: string;
    tertiaryColor: string;
    background: string;
    mainBkg: string;
    secondBkg: string;
    tertiaryBkg: string;
    textColor: string;
  };
  flowchart?: {
    useMaxWidth: boolean;
    htmlLabels: boolean;
    curve: string;
    padding: number;
    nodeSpacing: number;
    rankSpacing: number;
  };
  sequence?: {
    useMaxWidth: boolean;
    diagramMarginX: number;
    diagramMarginY: number;
    actorMargin: number;
    width: number;
    height: number;
    boxMargin: number;
    boxTextMargin: number;
    noteMargin: number;
    messageMargin: number;
  };
  gantt?: {
    useMaxWidth: boolean;
    leftPadding: number;
    rightPadding: number;
  };
}

export interface RenderResult {
  success: boolean;
  svg?: string;
  error?: string;
  warnings: string[];
  processingTime: number;
}

export interface MermaidRendererProps {
  code: string;
  config?: Partial<MermaidConfig>;
  onRendered?: (result: RenderResult) => void;
  onError?: (error: string) => void;
  className?: string;
  style?: React.CSSProperties;
}
