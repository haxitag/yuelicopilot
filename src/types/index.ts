// 工具调用记录
export interface ToolCallRecord {
  /** tool_call_id (if provided by provider) */
  id?: string;
  name: string;
  args: any;
  result?: string;
  error?: string;
  type: 'tool' | 'script';
  status?: 'running' | 'success' | 'error';
  startedAt?: number;
  durationMs?: number;
}

// 思考记录
export interface ThinkingRecord {
  content: string;
  timestamp: number;
}

/** 权限弹窗 allow/deny 摘要（写入审计同时展示在气泡侧栏） */
export interface PermissionAuditEntry {
  skillId: string;
  decision: 'allow_once' | 'allow_always' | 'deny';
  permissions: string[];
  at: number;
}

/** 单轮对话推理调用侧指标（来自 apiService.sendOllamaMessageWithMessages） */
export interface MessageMetrics {
  /** Provider HTTP 往返次数（含工具循环内的多轮 completion） */
  providerHttpRounds?: number;
  /** 本轮 send 总耗时 ms */
  totalLatencyMs?: number;
  /** 提示 token（多轮工具循环内各次 completion 的 usage 之和，需服务端在流中返回 usage） */
  promptTokens?: number;
  /** 生成 token（同上） */
  completionTokens?: number;
  /** 合计 token（同上） */
  totalTokens?: number;
}

export type OrchestratorStage = 'analyze' | 'prepare' | 'execute' | 'transform' | 'complete' | 'error';

export interface ExecutionTimelineItem {
  runId: string;
  stage: OrchestratorStage;
  at: number;
  /** stage-end duration in ms if available */
  durationMs?: number;
  message?: string;
}

// 消息类型定义
export interface Message {
  id: string;
  role: string;
  content: string;
  sender: string;
  time: string;
  isThinking: boolean;
  status?: 'sending' | 'sent' | 'failed';
  provider?: string;
  model?: string;
  sources?: Array<{
    name: string;
    type: string;
    url?: string;
  }>;
  metadata?: {
    agent_id?: string;
    [key: string]: any;
  };
  toolCalls?: Array<any>;
  toolCallId?: string;
  reasoningContent?: string;
  
  // 新增字段：技能调用和工具执行记录
  toolCallRecords?: ToolCallRecord[];
  thinkingRecords?: ThinkingRecord[];
  skillsUsed?: string[];
  finalStatus?: 'done' | 'error' | 'in_progress';
  executionTimeline?: ExecutionTimelineItem[];

  /** 本轮推理/工具循环指标 */
  metrics?: MessageMetrics;

  /** 用户在权限弹窗中的决策轨迹 */
  permissionAuditTrail?: PermissionAuditEntry[];
}

// 聊天文件类型
export interface ChatFile {
  id: string;
  name: string;
  type: string;
  size: number;
  file: File;
  url?: string;
}

// API配置类型
export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
  timeout: number;
  ollamaBaseUrl?: string;
}

// Ollama模型类型
export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

// Ollama消息类型
export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
}

// Ollama响应类型
export interface OllamaResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  eval_count?: number;
}

// 知识库类型
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  type: 'local' | 'remote';
  path?: string;
  url?: string;
}

// 推理结果类型
export interface InferenceResult {
  type: 'text' | 'image' | 'audio' | 'video' | 'code' | 'table';
  content: string;
  metadata?: {
    [key: string]: any;
  };
}

// 流式输出类型
export interface StreamChunk {
  id: string;
  content: string;
  isFinal: boolean;
  metadata?: {
    [key: string]: any;
  };
}

// ==================== Skills相关类型 ====================

export type SkillCategory = 
  | 'coding'           // 代码生成和分析
  | 'writing'          // 文本创作和优化
  | 'analysis'         // 数据分析和处理
  | 'automation'       // 任务自动化
  | 'database'         // 数据库操作
  | 'file'             // 文件处理
  | 'web'              // 网页和API交互
  | 'productivity'     // 生产力工具
  | 'system'           // 系统约束类技能
  | 'other';           // 其他

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  installed: boolean;
  url?: string;
  category: SkillCategory;
  tags: string[];
  structure: {
    skimmable: boolean;
    folders?: Array<{
      name: string;
      files?: string[];
      folders?: Array<any>;
    }>;
    files: string[];
  };
  permissions: SkillPermission[];
  source?: 'local' | 'github' | 'gist' | 'agent-skills';
}

export interface SkillConfig {
  name: string;
  description: string;
  systemPrompt: string;
  systemPromptRef?: string;
  tools?: SkillTool[];
  outputTemplate?: string;
  
  // 记忆和资源需求标记
  requiresMemory?: boolean;      // 是否需要记忆上下文
  requiresTools?: boolean;       // 是否需要工具调用
  requiresSandbox?: boolean;     // 是否需要sandbox隔离
}

export interface SkillTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (params: any) => Promise<any>;
}

export interface SkillExecutionContext {
  skill: Skill;
  userInput: string;
  history: Message[];
  variables: Record<string, any>;
}

// ==================== 权限系统 ====================

export type SkillPermission = 
  | 'file.read'
  | 'file.write'
  | 'file.delete'
  | 'network.http'
  | 'network.api'
  | 'process.execute'
  | 'environment.read'
  | 'localStorage.access'
  | 'notification.send'
  | 'clipboard.read'
  | 'clipboard.write';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requested: SkillPermission;
  timestamp: Date;
}

export interface PermissionPolicy {
  skillId: string;
  permissions: SkillPermission[];
  mode: 'allow-all' | 'deny-all' | 'custom';
  customRules?: Array<{
    permission: SkillPermission;
    allowed: boolean;
    conditions?: Record<string, any>;
  }>;
}

// ==================== 沙箱系统 ====================

export interface ResourceQuota {
  maxCpu: number;           // 最大CPU使用率百分比
  maxMemory: number;        // 最大内存使用MB
  maxDuration: number;      // 最大执行时间秒
  maxNetworkCalls: number;  // 最大网络调用次数
  maxFileReads: number;     // 最大文件读取次数
  maxFileWrites: number;    // 最大文件写入次数
}

export interface SandboxMetrics {
  startTime: Date;
  cpuUsage: number;
  memoryUsage: number;
  networkCalls: number;
  fileReads: number;
  fileWrites: number;
  isTimedOut: boolean;
}

export interface SandboxExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  metrics: SandboxMetrics;
}

// ==================== 技能集合 ====================

export interface SkillCollection {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  createdAt: Date;
  updatedAt: Date;
  icon?: string;
  color?: string;
}

// ==================== 本地技能发现 ====================

export interface LocalSkillSource {
  directory: string;
  platform: 'trae' | 'claude-code' | 'cursor' | 'other' | 'skills-manage' | 'custom' | 'codex' | 'copilot' | 'codewhisperer' | 'tabnine' | 'yueli';
  skills: Array<{
    id: string;
    path: string;
    name: string;
    manifest?: any;
  }>;
}

export interface LocalSkillManifest {
  name: string;
  description: string;
  version: string;
  author: string;
  category?: SkillCategory;
  tags?: string[];
  permissions?: SkillPermission[];
  files?: string[];
  entry?: string;
}

// ==================== MCP连接器相关类型 ====================

export interface MCPConnector {
  id: string;
  name: string;
  type: 'api' | 'database' | 'file' | 'web' | 'custom';
  config: Record<string, any>;
  connected: boolean;
}

export interface MCPConnectorConfig {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  [key: string]: any;
}

export interface MCPQuery {
  connectorId: string;
  action: string;
  params: Record<string, any>;
}

export interface MCPResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ==================== 输出模板相关类型 ====================

export interface OutputTemplate {
  id: string;
  name: string;
  type: 'markdown' | 'html' | 'json' | 'text';
  format: string;
  variables: TemplateVariable[];
  description: string;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  defaultValue?: any;
}

export interface TemplateRenderContext {
  template: OutputTemplate;
  data: Record<string, any>;
  options?: {
    escapeHtml?: boolean;
    minify?: boolean;
  };
}

export interface RenderedOutput {
  type: 'markdown' | 'html' | 'json' | 'text';
  content: string;
  metadata?: Record<string, any>;
}

// ==================== 核心管理器类型 ====================

export interface ExecutionPlan {
  skills: string[];
  connectors: MCPQuery[];
  outputTemplate?: string;
}

export interface ExecutionResult {
  success: boolean;
  skillResults?: Record<string, any>;
  connectorResults?: Record<string, MCPResponse>;
  renderedOutput?: RenderedOutput;
  error?: string;
}

// ==================== 完整架构类型扩展 ====================

// 插件状态枚举
export enum PluginStatus {
  INSTALLING = 'installing',
  INSTALLED = 'installed',
  ENABLED = 'enabled',
  ACTIVE = 'active',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  DISABLED = 'disabled',
  UNINSTALLING = 'uninstalling',
  UNINSTALLED = 'uninstalled',
  ERROR = 'error'
}

// 连接器状态枚举
export enum ConnectorStatus {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ACTIVE = 'active',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  ERROR = 'error'
}

// 执行阶段枚举
export enum ExecutionPhase {
  INIT = 'init',
  ANALYZE = 'analyze',
  PREPARE = 'prepare',
  EXECUTE = 'execute',
  TRANSFORM = 'transform',
  COMPLETE = 'complete',
  ERROR = 'error'
}

// 错误级别枚举
export enum ErrorLevel {
  FATAL = 'fatal',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info'
}

// 技能生命周期状态枚举
export enum SkillLifecycleStatus {
  DISCOVERED = 'discovered',       // 发现但未安装
  INSTALLING = 'installing',       // 安装中
  INSTALLED = 'installed',          // 已安装但未启用
  ENABLING = 'enabling',            // 启用中
  ENABLED = 'enabled',              // 已启用
  ACTIVE = 'active',                // 活跃（正在执行）
  EXECUTING = 'executing',          // 执行中
  COMPLETED = 'completed',           // 执行完成
  FAILED = 'failed',                // 失败
  DISABLING = 'disabling',          // 禁用中
  DISABLED = 'disabled',             // 已禁用
  UNINSTALLING = 'uninstalling',     // 卸载中
  UNINSTALLED = 'uninstalled',       // 已卸载
  ERROR = 'error'                    // 错误状态
}

// 技能生命周期状态转换
export interface SkillLifecycleTransition {
  from: SkillLifecycleStatus;
  to: SkillLifecycleStatus;
  action: string;
  condition?: (current: SkillLifecycleStatus) => boolean;
}

// 审计类型枚举
export enum AuditType {
  INSTALL = 'install',
  UNINSTALL = 'uninstall',
  ENABLE = 'enable',
  DISABLE = 'disable',
  EXECUTE = 'execute',
  SKILL_EXECUTION = 'skill_execution',
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  RESOURCE_ACQUIRE = 'resource_acquire',
  RESOURCE_RELEASE = 'resource_release',
  /** 聊天权限弹窗（allow_once / always / deny） */
  PERMISSION_UI = 'permission_ui',
  TEST_SKILL_START = 'TEST_SKILL_START',
  TEST_SKILL_COMPLETE = 'TEST_SKILL_COMPLETE',
  TEST_SKILL_ERROR = 'TEST_SKILL_ERROR',
  INSTALL_SKILL_START = 'INSTALL_SKILL_START',
  INSTALL_SKILL_COMPLETE = 'INSTALL_SKILL_COMPLETE',
  INSTALL_SKILL_ERROR = 'INSTALL_SKILL_ERROR'
}

// 插件依赖
export interface PluginDependency {
  id: string;
  version?: string;
  optional?: boolean;
}

// 插件配置
export interface PluginConfig {
  [key: string]: any;
}

/** 技能仓库来源（与 EventManager.RepositoryParser.parseUrl 一致） */
export type SkillRepositoryKind =
  | 'github'
  | 'gitlab'
  | 'gist'
  | 'skillsh'
  | 'skillhub'
  | 'tencent_skillhub'
  | 'skillhub_wtf'
  | 'local';

// 插件元数据
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
  type: 'skill' | 'connector';
  description: string;
  dependencies: PluginDependency[];
  capabilities: string[];
  permissions: string[];
  configuration: PluginConfig;
  repository?: {
    type: SkillRepositoryKind;
    url: string;
    ref?: string;
  };
}

// 错误信息
export interface ErrorInfo {
  code: string;
  message: string;
  details?: any;
  stack?: string;
  timestamp: Date;
}

// 执行状态
export interface ExecutionState {
  instanceId: string;
  pluginId: string;
  pluginType: 'skill' | 'connector';
  phase: ExecutionPhase;
  status: PluginStatus;
  progress: number;
  progressMessage?: string;
  startTime: Date;
  endTime?: Date;
  error?: ErrorInfo;
  context: Record<string, any>;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  metadata?: Record<string, any>;
}

// 审计记录
export interface AuditRecord {
  id: string;
  timestamp: Date;
  type: AuditType;
  pluginId: string;
  instanceId?: string;
  userId?: string;
  status: 'success' | 'failed';
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  duration?: number;
  error?: string;
  metadata?: Record<string, any>;
}

// 插件事件
export interface PluginEvent {
  eventName: string;
  pluginId?: string;
  instanceId?: string;
  timestamp: Date;
  data?: any;
  metadata?: Record<string, any>;
}

// 资源信息
export interface ResourceInfo {
  resourceId: string;
  resourceType: 'cpu' | 'memory' | 'network' | 'database' | 'file' | 'api';
  status: 'available' | 'acquired' | 'released' | 'error';
  owner?: string;
  acquireTime?: Date;
  releaseTime?: Date;
  metadata?: Record<string, any>;
}

// 归一化数据
export interface NormalizedData {
  type: string;
  format: string;
  data: any;
  metadata: {
    source: string;
    timestamp: Date;
    validated: boolean;
    [key: string]: any;
  };
}

// 插件实例（技能）
export interface SkillInstance extends Skill {
  instanceId: string;
  status: PluginStatus;
  enabled: boolean;
  metadata?: PluginMetadata;
  executionState?: ExecutionState;
  config?: PluginConfig;
  createdAt: Date;
  updatedAt: Date;
}

// 插件实例（连接器）
export interface ConnectorInstance extends MCPConnector {
  instanceId: string;
  status: ConnectorStatus;
  enabled: boolean;
  metadata?: PluginMetadata;
  executionState?: ExecutionState;
  pluginConfig?: PluginConfig;
  createdAt: Date;
  updatedAt: Date;
}

// 事件处理器
export interface EventHandler {
  eventName: string;
  handler: (event: PluginEvent) => void | Promise<void>;
  priority: number;
  once?: boolean;
}

// 回放会话
export interface ReplaySession {
  sessionId: string;
  startAuditId: string;
  endAuditId?: string;
  createdAt: Date;
  status: 'ready' | 'playing' | 'paused' | 'completed' | 'error';
  currentIndex: number;
  speed: number;
  auditRecords: AuditRecord[];
}

// 仓库信息
export interface RepositoryInfo {
  type: SkillRepositoryKind;
  owner?: string;
  repo?: string;
  id?: string;
  ref?: string;
  url: string;
  rawUrl?: string;
}

// ==================== 定时任务与回调相关类型 ====================

// 定时任务状态
export enum ScheduleStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// 定时任务执行策略
export enum ScheduleStrategy {
  ONCE = 'once',
  REPEAT = 'repeat',
  CRON = 'cron',
  INTERVAL = 'interval'
}

// 资源调度策略
export enum ResourceSchedulingStrategy {
  PRIORITY = 'priority',           // 优先级调度
  FAIR = 'fair',                   // 公平调度
  RESOURCE_AWARE = 'resource_aware', // 资源感知调度
  LOAD_BALANCED = 'load_balanced',   // 负载均衡调度
  AFFINITY = 'affinity'             // 亲和性调度
}

// 资源调度配置
export interface ResourceSchedulingConfig {
  strategy: ResourceSchedulingStrategy;
  priority?: number;                // 优先级 (1-10, 越高越优先)
  weight?: number;                  // 权重 (用于公平调度)
  requiredResources?: {             // 所需资源
    cpu?: number;
    memory?: number;
    network?: boolean;
    gpu?: boolean;
  };
  preferredResources?: {            // 偏好资源
    cpu?: number;
    memory?: number;
    network?: boolean;
    gpu?: boolean;
  };
  maxConcurrent?: number;           // 最大并发数
  timeout?: number;                 // 超时时间（毫秒）
  retryPolicy?: RetryPolicy;         // 重试策略
}

// 重试策略
export interface RetryPolicy {
  maxRetries: number;               // 最大重试次数
  initialDelay: number;              // 初始延迟（毫秒）
  maxDelay: number;                 // 最大延迟（毫秒）
  backoffMultiplier: number;        // 退避倍数
  retryableErrors?: string[];       // 可重试的错误类型
}

// 定时任务配置
export interface ScheduleConfig {
  strategy: ScheduleStrategy;
  delay?: number;               // 延迟执行（毫秒）
  interval?: number;            // 间隔执行（毫秒）
  cronExpression?: string;      // Cron表达式
  repeatCount?: number;         // 重复次数
  maxRetries?: number;          // 最大重试次数
  timeout?: number;             // 超时时间（毫秒）
  resourceScheduling?: ResourceSchedulingConfig; // 资源调度配置
}

// 定时任务
export interface ScheduleTask {
  taskId: string;
  pluginId: string;
  pluginType: 'skill' | 'connector';
  name: string;
  description?: string;
  config: ScheduleConfig;
  status: ScheduleStatus;
  callback?: TaskCallback;
  createdAt: Date;
  updatedAt: Date;
  lastExecuteTime?: Date;
  nextExecuteTime?: Date;
  executionCount: number;
  metadata?: Record<string, any>;
}

// 任务回调
export interface TaskCallback {
  onStart?: (task: ScheduleTask, context: any) => void | Promise<void>;
  onComplete?: (task: ScheduleTask, result: any) => void | Promise<void>;
  onError?: (task: ScheduleTask, error: Error) => void | Promise<void>;
  onProgress?: (task: ScheduleTask, progress: number, message?: string) => void | Promise<void>;
  onRetry?: (task: ScheduleTask, retryCount: number, error: Error) => void | Promise<void>;
}

// 状态回调注册
export interface StatusCallbackRegistration {
  id: string;
  pluginId: string;
  pluginType: 'skill' | 'connector';
  events: PluginStatus[];
  callback: (state: ExecutionState, event: PluginEvent) => void | Promise<void>;
  once?: boolean;
  createdAt: Date;
}

// 定时更新任务配置
export interface UpdateScheduleConfig {
  pluginId: string;
  pluginType: 'skill' | 'connector';
  interval: number;              // 更新间隔（毫秒）
  config: Record<string, any>;   // 执行时传递的参数
  callback?: (data: any) => void | Promise<void>;
  enabled?: boolean;
}

// 技能测试结果
export interface SkillTestResult {
  success: boolean;
  skillId: string;
  message: string;
  errors?: string[];
  details?: string[];
  duration?: number;
  enabled?: boolean;
  timestamp: Date;
}

// ==================== 技能安装请求 ====================

/**
 * 技能分析结果 - 功能、用例、价值、权限和风险
 */
export interface SkillAnalysis {
  /** 技能功能描述 */
  capabilities: string[];
  /** 典型用例 */
  useCases: string[];
  /** 价值评估 */
  value: string;
  /** 潜在风险 */
  risks: string[];
  /** 隐私关注点 */
  privacyConcerns: string[];
}

/**
 * 技能安装请求 - 从 URL 检测到待安装的技能
 */
export interface SkillInstallRequest {
  /** 原始 URL */
  url: string;
  /** 技能 ID */
  skillId: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 版本号 */
  version: string;
  /** 作者 */
  author: string;
  /** 来源类型 */
  source: SkillRepositoryKind | 'unknown';
  /** 权限列表 */
  permissions: SkillPermission[];
  /** 依赖列表 */
  dependencies: string[];
  /** 工具列表 */
  tools: Array<{ name: string; description: string; parameters?: unknown }>;
  /** 标签 */
  tags: string[];
  /** 分析结果 */
  analysis: SkillAnalysis;
}