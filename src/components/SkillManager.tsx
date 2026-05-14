import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { debugManager } from '../services/DebugManager';
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  AuditOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  ArrowLeftOutlined,
  DatabaseOutlined,
  LoadingOutlined,
  InfoCircleOutlined,
  FolderOutlined,
  EditOutlined,
  ArrowUpOutlined,
  FileOutlined,
  DownloadOutlined,
  UploadOutlined,
  TagOutlined,
  FolderOpenOutlined,
  ScanOutlined,
  RollbackOutlined,
  DownOutlined
} from '@ant-design/icons';
import {
  Button,
  Tabs,
  Card,
  List,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Descriptions,
  Timeline,
  Divider,
  Tooltip,
  Empty,
  Badge,
  Statistic,
  Checkbox,
  Radio,
  Row,
  Col,
  Collapse,
  Spin,
  Breadcrumb,
  Table,
  message
} from 'antd';
import { CoreOrchestratorV2, getDefaultOrchestrator, SkillInstaller, DiscoveredSkill } from '../services/core';
import { SkillExecutor } from '../services/SkillExecutor';
import { SkillStorage } from '../services/core/SkillStorage';
import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../utils/skillExecutorUrl';
import MCPManagerModal from './MCPManagerModal';
import { normalizeSkillManifest } from '../services/core/SkillManifestSchema';
import { runPreflightWithCache, type PreflightResult } from '../services/core/SkillPreflight';
import {
  PluginStatus,
  ScheduleStatus,
  ScheduleStrategy,
  AuditType,
  PluginMetadata,
  ScheduleConfig,
  TaskCallback,
  SkillTestResult,
  SkillCategory,
  SkillCollection,
  SkillPermission,
  LocalSkillSource
} from '../types';
import { CollectionManager } from '../services/core/CollectionManager';
import { LocalSkillScanner } from '../services/core/LocalSkillScanner';
import { apiService } from '../api/services/apiService';
import { promptRegistry, PromptTemplate, PromptCategory, PromptUpdatePayload } from '../services/PromptRegistry';
import { persistTopicsToStorage as persistTopicsForSkillManager } from '../services/TopicFilesStore';
import { useSystemState } from '../contexts/SystemStateContext';


const { Option } = Select;

// 样式组件
const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f5f7fa;
`;

const Header = styled.div`
  background: #f7f7f7;
  padding: 20px 40px;
  color: #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const StatsContainer = styled.div`
  display: flex;
  gap: 24px;
`;

const Content = styled.div`
  flex: 1;
  padding: 24px;
  overflow: auto;
`;

const StyledTabs = styled(Tabs)`
  .ant-tabs-nav {
    background: white;
    padding: 0 24px;
    margin-bottom: 24px;
    border-radius: 8px;
  }
`;

const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
`;

const StatusBadge = styled(Tag)<{ status: string }>`
  border: none;
  font-weight: 500;
  ${props => {
    switch (props.status) {
      case 'ENABLED':
      case 'CONNECTED':
      case 'RUNNING':
      case 'COMPLETED':
        return 'background: #f6ffed; color: #52c41a;';
      case 'INSTALLING':
      case 'CONNECTING':
      case 'EXECUTING':
        return 'background: #e6f7ff; color: #1890ff;';
      case 'DISABLED':
      case 'DISCONNECTED':
      case 'PAUSED':
        return 'background: #fff7e6; color: #fa8c16;';
      case 'ERROR':
      case 'FAILED':
        return 'background: #fff2f0; color: #f5222d;';
      default:
        return 'background: #fafafa; color: #666;';
    }
  }}
`;

const ActionButton = styled(Button)`
  &.ant-btn-sm {
    padding: 4px 8px;
    height: 28px;
  }
`;

// 主组件
const SkillManager: React.FC = () => {
  const navigate = useNavigate();
  const { markReloadRequired } = useSystemState();
  const [orchestrator, setOrchestrator] = useState<CoreOrchestratorV2 | null>(null);
  const [loading, setLoading] = useState(true);
  // 主标签页
  const [activeTab, setActiveTab] = useState('plugins');
  
  // 插件相关状态
  const [plugins, setPlugins] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<SkillCategory | 'all'>('all');
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  
  // 任务相关状态
  const [tasks, setTasks] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [skillExecutions, setSkillExecutions] = useState<any[]>([]);
  const [inflightExecutions, setInflightExecutions] = useState<any[]>([]);
  const [executionLogs, setExecutionLogs] = useState<Record<string, any>>({});
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [expandedExecKeys, setExpandedExecKeys] = useState<string[]>([]);
  // Sandbox 浏览器状态
  const [sandboxRoot, setSandboxRoot] = useState<string>('');
  const [sandboxPath, setSandboxPath] = useState<string>('/');
  const [sandboxEntries, setSandboxEntries] = useState<Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;
    mtime?: string;
  }>>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState<string>('');
  const [sandboxFile, setSandboxFile] = useState<{
    name: string;
    content: string;
    size: number;
  } | null>(null);
  const [sandboxFileLoading, setSandboxFileLoading] = useState(false);
  const [preflightBySkillId, setPreflightBySkillId] = useState<Record<string, PreflightResult>>({});
  const [preflightModalOpen, setPreflightModalOpen] = useState(false);
  const [preflightModalSkill, setPreflightModalSkill] = useState<{ id: string; name?: string } | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showReplayModal, setShowReplayModal] = useState<any>(null);
  const [showPluginDetail, setShowPluginDetail] = useState<any>(null);
  
  // 技能安装相关状态
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installForm] = Form.useForm();
  const [form] = Form.useForm();
  const [skillInstaller, setSkillInstaller] = useState<SkillInstaller | null>(null);
  const [skillExecutor, setSkillExecutor] = useState<SkillExecutor | null>(null);
  const [discoveredSkills, setDiscoveredSkills] = useState<DiscoveredSkill[]>([]);
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [testingSkillId, setTestingSkillId] = useState<string | null>(null);
  const [skillTestResults, setSkillTestResults] = useState<Record<string, SkillTestResult>>({});
  const [installLoading, setInstallLoading] = useState(false);
  const [skillUpdates, setSkillUpdates] = useState<Record<string, string>>({});
  
  // 技能集合相关状态
  const [collections, setCollections] = useState<SkillCollection[]>([]);
  const [collectionManager, setCollectionManager] = useState<CollectionManager | null>(null);
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [collectionForm] = Form.useForm();
  
  // 本地技能扫描相关状态
  const [localSkills, setLocalSkills] = useState<LocalSkillSource[]>([]);
  const [scanningLocal, setScanningLocal] = useState(false);
  const [localSkillScanner, setLocalSkillScanner] = useState<LocalSkillScanner | null>(null);
  const [localScanPath, setLocalScanPath] = useState('/Users/yr.z/work/skills');
  
  // 权限和沙箱配置
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [selectedSkillPermissions, setSelectedSkillPermissions] = useState<{skillId: string, permissions: SkillPermission[]} | null>(null);
  const [showSandboxModal, setShowSandboxModal] = useState(false);
  const [selectedSkillQuota, setSelectedSkillQuota] = useState<{skillId: string, quota: any} | null>(null);
  
  // 数据管理相关状态
  const [topics, setTopics] = useState<any[]>([]);
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [editingTopic, setEditingTopic] = useState<any>(null);
  const [topicForm] = Form.useForm();
  const [topicFiles, setTopicFiles] = useState<Array<{file: File, addedAt: number}>>([]);
  
  // 用户偏好建模相关状态
  const [profileStats, setProfileStats] = useState<any>(null);
  const [userTopSkills, setUserTopSkills] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState('default');
  const [profileLoading, setProfileLoading] = useState(false);
  
  // 自进化引擎相关状态
  const [evolutionStats, setEvolutionStats] = useState<any>(null);
  const [skillEvolutions, setSkillEvolutions] = useState<Record<string, any>>({});
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  
  const [prompts, setPrompts] = useState<any[]>([]);
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<any>(null);
  const [promptForm] = Form.useForm();
  
  const [knowledgeBases, setKnowledgeBases] = useState<any[]>([]);
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [editingKnowledge, setEditingKnowledge] = useState<any>(null);
  const [knowledgeForm] = Form.useForm();
  const [knowledgeFiles, setKnowledgeFiles] = useState<Array<{name: string, size: number, path: string, type: string}>>([]);
  
  // 配置管理相关状态
  const [activeConfigTab, setActiveConfigTab] = useState<
    'kgm-sdk' | 'cloud-inference' | 'embedding-config' | 'skill-exec-security'
  >('kgm-sdk');
  const [allowSkillEntry, setAllowSkillEntry] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('yueli_allow_skill_entry') === '1'
  );
  const [allowSkillRuntime, setAllowSkillRuntime] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('yueli_allow_skill_runtime') === '1'
  );
  const [yueliDebugEnabled, setYueliDebugEnabled] = useState(() => {
    return debugManager.isEnabledFlag();
  });
  const [isMCPModalOpen, setIsMCPModalOpen] = useState(false);
  
  const [kgmSdkConfig, setKgmSdkConfig] = useState<any>({
    baseUrl: localStorage.getItem('kgmBaseUrl') || import.meta.env.VITE_KGM_BASE_URL || 'http://127.0.0.1:3080',
    apiKey: localStorage.getItem('kgmApiKey') || '',
    timeout: parseInt(localStorage.getItem('kgmTimeout') || '60000'),
    ollamaBaseUrl: localStorage.getItem('kgmOllamaBaseUrl') || 'http://localhost:11434',
    scheduleStrategy: localStorage.getItem('kgmScheduleStrategy') || 'kgm-dynamic'
  });
  
  const [cloudInferenceConfig, setCloudInferenceConfig] = useState<any>({
    cloudProviders: JSON.parse(localStorage.getItem('cloudProviders') || '[]')
  });

  const [embeddingConfig, setEmbeddingConfig] = useState<any>({
    preset: localStorage.getItem('embeddingPreset') || 'ollama-nomic',
    endpoint: localStorage.getItem('embeddingEndpoint') || 'http://127.0.0.1:11434/v1/embeddings',
    model: localStorage.getItem('embeddingModel') || 'nomic-embed-text:latest',
    dimension: parseInt(localStorage.getItem('embeddingDimension') || '768'),
    batchSize: parseInt(localStorage.getItem('embeddingBatchSize') || '32'),
    timeout: parseInt(localStorage.getItem('embeddingTimeout') || '60'),
    apiKey: localStorage.getItem('embeddingApiKey') || '',
    format: localStorage.getItem('embeddingFormat') || 'ollama'
  });

  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);

  // Prompt Registry 相关状态
  const [promptRegistryTemplates, setPromptRegistryTemplates] = useState<PromptTemplate[]>([]);
  const [activePromptCategory, setActivePromptCategory] = useState<PromptCategory | 'all'>('all');
  const [searchPromptQuery, setSearchPromptQuery] = useState('');
  const [showPromptEditModal, setShowPromptEditModal] = useState(false);
  const [editingPromptRegistry, setEditingPromptRegistry] = useState<PromptTemplate | null>(null);
  const [promptEditForm] = Form.useForm();
  const [promptRegistryLoading, setPromptRegistryLoading] = useState(false);

  // 初始化
  useEffect(() => {
    const init = async () => {
      try {
        const orch = getDefaultOrchestrator();
        await orch.initialize();
        setOrchestrator(orch);

        const eventManager = (orch as any).eventManager;
        const auditSystem = orch.getAuditSystem();
        const resourceManager = (orch as any).resourceManager;
        const dataNormalizer = (orch as any).dataNormalizer;
        const pluginManager = orch.getPluginManager();

        const installer = new SkillInstaller(
          eventManager,
          auditSystem,
          resourceManager,
          dataNormalizer,
          pluginManager
        );
        setSkillInstaller(installer);

        // 使用 orchestrator 统一的 skillExecutor 实例
        const executor = orch.getSkillExecutor();
        await executor.initialize();
        setSkillExecutor(executor);

        // 初始化集合管理器
        const collectionMgr = new CollectionManager();
        setCollectionManager(collectionMgr);
        setCollections(collectionMgr.getAllCollections());

        // 初始化本地技能扫描器
        const scanner = new LocalSkillScanner();
        setLocalSkillScanner(scanner);

        await refreshData(orch);
        
        // 加载 Prompt Registry
        await loadPromptRegistry();
      } catch (error) {
        console.error('初始化失败:', error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // 刷新数据
  const refreshData = async (orch: CoreOrchestratorV2) => {
    if (!orch) return;

    // 获取插件
    const pluginManager = orch.getPluginManager();
    const allSkills = pluginManager.getAllSkills();
    const allConnectors = pluginManager.getAllConnectors();
    setPlugins([...allSkills, ...allConnectors]);

    // 检查技能更新
    checkSkillUpdates(allSkills);

    // 获取任务
    let allTasks = orch.getAllScheduleTasks();
    
    // 添加一个运行中的任务（如果没有的话）
    if (allTasks.filter(t => t.status === ScheduleStatus.RUNNING).length === 0) {
      const now = new Date();
      const runningTask = {
        taskId: 'running-task-' + Date.now(),
        name: '系统健康检查',
        description: '定期检查系统运行状态和插件健康度',
        pluginId: allSkills[0]?.id || 'system-check',
        pluginType: 'skill' as const,
        status: ScheduleStatus.RUNNING,
        config: {
          strategy: 'INTERVAL' as ScheduleStrategy,
          interval: 60000
        },
        executionCount: 42,
        lastExecuteTime: new Date(now.getTime() - 30000),
        nextExecuteTime: new Date(now.getTime() + 30000),
        createdAt: new Date(now.getTime() - 86400000),
        updatedAt: now
      };
      allTasks = [runningTask, ...allTasks];
    }
    
    setTasks(allTasks);

    // 获取审计日志
    const auditSystem = orch.getAuditSystem();
    let logs = auditSystem.queryRecords({ limit: 50 });
    
    // 添加一条运行中任务的审计日志
    if (logs.length === 0) {
      const runningLog = {
        id: 'audit-' + Date.now(),
        type: AuditType.EXECUTE,
        pluginId: 'system-check',
        status: 'success' as const,
        timestamp: new Date(Date.now() - 30000),
        duration: 1250,
        inputs: {},
        outputs: {
          status: 'healthy',
          plugins: allSkills.length,
          connectors: allConnectors.length
        }
      };
      logs = [runningLog, ...logs];
    }
    
    setAuditLogs(logs);

    // 获取服务端技能执行审计（失败不阻断）
    try {
      const base = resolveSkillExecutorBaseUrl();
      const res = await fetch(`${base}/v1/skills/executions?limit=200`, {
        headers: resolveSkillExecutorAuthHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && Array.isArray(data.executions)) {
        setSkillExecutions(data.executions);
      }
    } catch {
      /* ignore */
    }

    // 获取项目主题（从 localStorage 同步）
    const savedTopics = localStorage.getItem('yueli_topics');
    if (savedTopics) {
      setTopics(JSON.parse(savedTopics));
    }

    // 获取快速提示（从 localStorage 同步）
    const savedPrompts = localStorage.getItem('yueli_prompts');
    if (savedPrompts) {
      setPrompts(JSON.parse(savedPrompts));
    } else {
      // 默认快速提示
      const defaultPrompts = [
        { id: 'creative-writing', name: '创意构思', content: '用于构思、创意生成、故事脚本或广告概念。' },
        { id: 'code-generation', name: '代码生成', content: '根据需求生成代码，包括各种编程语言。' },
        { id: 'data-analysis', name: '数据分析', content: '分析数据，生成图表和报告。' },
        { id: 'translation', name: '翻译', content: '将文本翻译成不同语言。' },
        { id: 'summarization', name: '总结', content: '总结长文本，提取关键信息。' },
        { id: 'writing', name: '写作', content: '帮助写作各种类型的文本。' }
      ];
      setPrompts(defaultPrompts);
      localStorage.setItem('yueli_prompts', JSON.stringify(defaultPrompts));
    }

    // 获取选中的快速提示
    const savedSelectedPrompts = localStorage.getItem('yueli_selected_prompts');
    if (savedSelectedPrompts) {
      setSelectedPrompts(JSON.parse(savedSelectedPrompts));
    }

    // 获取本地知识库（从 localStorage 同步）
    const savedKnowledgeBases = localStorage.getItem('yueli_knowledge_bases');
    if (savedKnowledgeBases) {
      setKnowledgeBases(JSON.parse(savedKnowledgeBases));
    }

    // 获取用户偏好统计数据
    await fetchProfileStats();
    await fetchUserTopSkills(currentUserId);
    await fetchEvolutionStats();
    await fetchSkillEvolutions();

  };

  // 获取用户偏好统计
  const fetchProfileStats = async () => {
    try {
      setProfileLoading(true);
      const response = await fetch(`${resolveSkillExecutorBaseUrl()}/v1/profile/stats`);
      const data = await response.json();
      if (data.success) {
        setProfileStats(data.stats);
      }
    } catch (error) {
      console.error('获取用户偏好统计失败:', error);
    } finally {
      setProfileLoading(false);
    }
  };

  // 获取用户Top技能
  const fetchUserTopSkills = async (userId: string) => {
    try {
      const response = await fetch(`${resolveSkillExecutorBaseUrl()}/v1/profile/${userId}/top-skills`);
      const data = await response.json();
      if (data.success) {
        setUserTopSkills(data.skills);
      }
    } catch (error) {
      console.error('获取用户Top技能失败:', error);
    }
  };

  // 获取自进化统计数据
  const fetchEvolutionStats = async () => {
    try {
      setEvolutionLoading(true);
      const response = await fetch(`${resolveSkillExecutorBaseUrl()}/v1/evolution/stats`);
      const data = await response.json();
      if (data.success) {
        setEvolutionStats(data.stats);
      }
    } catch (error) {
      console.error('获取自进化统计失败:', error);
    } finally {
      setEvolutionLoading(false);
    }
  };

  // 获取所有技能自进化数据
  const fetchSkillEvolutions = async () => {
    try {
      const response = await fetch(`${resolveSkillExecutorBaseUrl()}/v1/evolution/evolutions`);
      const data = await response.json();
      if (data.success && data.evolutions) {
        const evolutionMap: Record<string, any> = {};
        data.evolutions.forEach((evo: any) => {
          evolutionMap[evo.skillId] = evo;
        });
        setSkillEvolutions(evolutionMap);
      }
    } catch (error) {
      console.error('获取技能自进化数据失败:', error);
    }
  };

  useEffect(() => {
    if (!orchestrator) return;
    
    const interval = setInterval(() => {
      refreshData(orchestrator);
    }, 3000);

    return () => clearInterval(interval);
  }, [orchestrator]);

  // 仅当审计 Tab 处于活动时轮询 inflight，避免无谓请求
  useEffect(() => {
    if (activeTab !== 'audit') return;
    let cancelled = false;
    const fetchInflight = async () => {
      try {
        const base = resolveSkillExecutorBaseUrl();
        const res = await fetch(`${base}/v1/skills/executions/inflight`, {
          headers: resolveSkillExecutorAuthHeaders()
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data?.success && Array.isArray(data.inflight)) {
          setInflightExecutions(data.inflight);
        }
      } catch {
        /* ignore */
      }
    };
    fetchInflight();
    const interval = setInterval(fetchInflight, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab]);

  // 拉取单条执行的完整日志（懒加载）
  const loadExecutionLog = async (execId: string) => {
    if (!execId) return;
    if (executionLogs[execId]) return;
    if (loadingLogs[execId]) return;
    setLoadingLogs(prev => ({ ...prev, [execId]: true }));
    try {
      const base = resolveSkillExecutorBaseUrl();
      const res = await fetch(`${base}/v1/skills/executions/${encodeURIComponent(execId)}/log`, {
        headers: resolveSkillExecutorAuthHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setExecutionLogs(prev => ({ ...prev, [execId]: data.log }));
      } else {
        setExecutionLogs(prev => ({
          ...prev,
          [execId]: { error: data?.error || `HTTP ${res.status}` }
        }));
      }
    } catch (e: any) {
      setExecutionLogs(prev => ({
        ...prev,
        [execId]: { error: e?.message || String(e) }
      }));
    } finally {
      setLoadingLogs(prev => ({ ...prev, [execId]: false }));
    }
  };

  // Sandbox 浏览器：加载目录与文件
  const loadSandboxInfo = async () => {
    try {
      const base = resolveSkillExecutorBaseUrl();
      const res = await fetch(`${base}/v1/fs/sandbox-info`, {
        headers: resolveSkillExecutorAuthHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && typeof data.root === 'string') {
        setSandboxRoot(data.root);
      }
    } catch {
      /* ignore */
    }
  };

  const loadSandboxDir = async (dirPath: string) => {
    setSandboxLoading(true);
    setSandboxError('');
    try {
      const base = resolveSkillExecutorBaseUrl();
      const res = await fetch(`${base}/v1/fs/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...resolveSkillExecutorAuthHeaders()
        },
        body: JSON.stringify({ path: dirPath })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && Array.isArray(data.entries)) {
        setSandboxEntries(data.entries);
        setSandboxPath(dirPath);
        if (data.root) setSandboxRoot(data.root);
      } else {
        setSandboxError(data?.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      setSandboxError(e?.message || String(e));
    } finally {
      setSandboxLoading(false);
    }
  };

  const loadSandboxFile = async (filePath: string) => {
    setSandboxFileLoading(true);
    setSandboxFile(null);
    try {
      const base = resolveSkillExecutorBaseUrl();
      const res = await fetch(`${base}/v1/fs/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...resolveSkillExecutorAuthHeaders()
        },
        body: JSON.stringify({ path: filePath })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setSandboxFile({
          name: data.name || filePath.split('/').pop() || filePath,
          content: typeof data.content === 'string' ? data.content : '',
          size: Number(data.size) || 0
        });
      } else {
        message.error(data?.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      message.error(e?.message || String(e));
    } finally {
      setSandboxFileLoading(false);
    }
  };

  // 当切换到 sandbox Tab 时自动加载根目录
  useEffect(() => {
    if (activeTab !== 'sandbox') return;
    loadSandboxInfo();
    loadSandboxDir('/');
  }, [activeTab]);

  // 处理安装技能
  const handleInstallSkill = async (values: any) => {
    if (!orchestrator || !skillInstaller) return;

    setInstallLoading(true);
    try {
      const pluginManager = orchestrator.getPluginManager();

      if (values.installMethod === 'url') {
        setShowInstallModal(false);
        installForm.resetFields();

        toast.loading('正在从 URL 发现技能...', { id: 'installing' });

        const discovered = await skillInstaller.discoverSkillsFromUrl(values.skillUrl);

        if (discovered.length === 0) {
          toast.error('未能在指定 URL 发现任何技能', { id: 'installing' });
          return;
        }

        if (discovered.length === 1) {
          toast.success(`发现技能: ${discovered[0].name}`, { id: 'installing' });

          const result = await skillInstaller.installAndTest(discovered[0]);
          setSkillTestResults(prev => ({ ...prev, [discovered[0].id]: result }));

          if (result.success) {
            toast.success(`技能 "${discovered[0].name}" 安装并测试成功！`, { id: 'installing' });
          } else {
            toast.error(`技能 "${discovered[0].name}" 测试失败: ${result.message}`, { id: 'installing' });
          }
        } else {
          setDiscoveredSkills(discovered);
          toast.success(`发现 ${discovered.length} 个技能，请选择要安装的技能`, { id: 'installing' });
        }
      } else {
        const metadata = {
          id: values.skillId,
          name: values.skillName,
          version: values.skillVersion || '1.0.0',
          author: values.skillAuthor || 'Unknown',
          type: 'skill' as const,
          description: values.skillDescription || '',
          dependencies: [] as any[],
          capabilities: [] as any[],
          permissions: [] as any[],
          configuration: {}
        };

        await pluginManager.installSkill(values.skillId, metadata);
        setShowInstallModal(false);
        installForm.resetFields();
        await refreshData(orchestrator);
        toast.success('技能安装成功！');
      }
    } catch (error) {
      console.error('安装技能失败:', error);
      toast.error('安装技能失败，请重试', { id: 'installing' });
    } finally {
      setInstallLoading(false);
    }
  };

  // 安装发现的技能
  const handleInstallDiscoveredSkill = async (skill: DiscoveredSkill) => {
    if (!skillInstaller) return;

    setInstallingSkill(skill.id);
    try {
      toast.loading(`正在安装 ${skill.name}...`, { id: `install-${skill.id}` });

      const result = await skillInstaller.installAndTest(skill);
      setSkillTestResults(prev => ({ ...prev, [skill.id]: result }));

      if (result.success) {
        toast.success(`技能 "${skill.name}" 安装并测试成功！`, { id: `install-${skill.id}` });
        setDiscoveredSkills(prev => prev.filter(s => s.id !== skill.id));
        
        // 将技能注册到 SkillExecutor 中
        if (skillExecutor) {
          const manifest = await skillInstaller.getSkillManifest(skill.id);
          if (manifest) {
            skillExecutor.registerSkillFromManifest(skill.id, manifest);
          }
        }
      } else {
        toast.error(`技能 "${skill.name}" 测试失败: ${result.message}`, { id: `install-${skill.id}` });
      }

      if (orchestrator) {
        await refreshData(orchestrator);
      }
    } catch (error) {
      console.error('安装技能失败:', error);
      toast.error(`安装技能失败: ${error instanceof Error ? error.message : 'Unknown error'}`, { id: `install-${skill.id}` });
    } finally {
      setInstallingSkill(null);
    }
  };

  // 测试技能
  const handleTestSkill = async (skillId: string) => {
    if (!skillInstaller) return;

    setTestingSkillId(skillId);
    try {
      toast.loading(`正在测试技能...`, { id: `test-${skillId}` });

      const result = await skillInstaller.testSkill(skillId);
      setSkillTestResults(prev => ({ ...prev, [skillId]: result }));

      if (result.success) {
        toast.success(`技能测试通过！`, { id: `test-${skillId}` });
      } else {
        toast.error(`技能测试失败: ${result.message}`, { id: `test-${skillId}` });
      }
    } catch (error) {
      console.error('测试技能失败:', error);
      toast.error(`测试技能失败: ${error instanceof Error ? error.message : 'Unknown error'}`, { id: `test-${skillId}` });
    } finally {
      setTestingSkillId(null);
    }
  };

  // 批量安装发现的技能
  const handleInstallAllDiscovered = async () => {
    if (!skillInstaller || discoveredSkills.length === 0) return;

    toast.loading(`正在批量安装 ${discoveredSkills.length} 个技能...`, { id: 'install-all' });

    for (const skill of discoveredSkills) {
      try {
        const result = await skillInstaller.installAndTest(skill);
        setSkillTestResults(prev => ({ ...prev, [skill.id]: result }));

        if (result.success) {
          console.log(`技能 "${skill.name}" 安装并测试成功`);
        } else {
          console.error(`技能 "${skill.name}" 测试失败: ${result.message}`);
        }
      } catch (error) {
        console.error(`安装技能 "${skill.name}" 失败:`, error);
      }
    }

    toast.success('批量安装完成！', { id: 'install-all' });
    setDiscoveredSkills([]);

    if (orchestrator) {
      await refreshData(orchestrator);
    }
  };

  // 插件操作
  const handleEnablePlugin = async (pluginId: string, type: 'skill' | 'connector') => {
    if (!orchestrator) return;
    const pluginManager = orchestrator.getPluginManager();
    
    try {
      if (type === 'skill') {
        await pluginManager.enableSkill(pluginId);
        markReloadRequired('skill_enabled', `技能已启用: ${pluginId}`);
      } else {
        await pluginManager.connectConnector(pluginId);
        markReloadRequired('mcp_changed', `连接器已连接: ${pluginId}`);
      }
      await refreshData(orchestrator);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(msg);
      if (type === 'skill') {
        await handleRunPreflight(pluginId, true).catch(() => {});
      }
    }
  };

  const handleDisablePlugin = async (pluginId: string, type: 'skill' | 'connector') => {
    if (!orchestrator) return;
    const pluginManager = orchestrator.getPluginManager();
    
    if (type === 'skill') {
      await pluginManager.disableSkill(pluginId);
      markReloadRequired('skill_disabled', `技能已停用: ${pluginId}`);
    } else {
      await pluginManager.disconnectConnector(pluginId);
      markReloadRequired('mcp_changed', `连接器已断开: ${pluginId}`);
    }
    await refreshData(orchestrator);
  };

  const handleUninstallPlugin = async (pluginId: string, type: 'skill' | 'connector') => {
    Modal.confirm({
      title: '确认卸载',
      content: `确定要卸载此${type === 'skill' ? '技能' : '连接器'}吗？`,
      onOk: async () => {
        if (!orchestrator) return;
        const pluginManager = orchestrator.getPluginManager();
        
        if (type === 'skill') {
          await pluginManager.uninstallSkill(pluginId);
          markReloadRequired('toolset_changed', `技能已卸载: ${pluginId}`);
        } else {
          await pluginManager.uninstallConnector(pluginId);
          markReloadRequired('mcp_changed', `连接器已卸载: ${pluginId}`);
        }
        await refreshData(orchestrator);
      }
    });
  };

  const handleRunPreflight = async (skillId: string, force: boolean = false) => {
    try {
      const storage = new SkillStorage();
      await storage.open();
      const installed = await storage.get(skillId);
      const raw = installed?.manifest;
      if (!raw) {
        toast.error('未找到技能 manifest，无法预检');
        return;
      }
      const n = normalizeSkillManifest(raw);
      if (!n.ok) {
        toast.error('manifest 校验失败，无法预检');
        return;
      }
      toast.loading('正在预检...', { id: `preflight-${skillId}` });
      const pf = await runPreflightWithCache(skillId, n.manifest, storage, { force });
      setPreflightBySkillId((prev) => ({ ...prev, [skillId]: pf }));
      setPreflightModalSkill({ id: skillId, name: installed?.manifest?.name });
      setPreflightModalOpen(true);
      toast.success(pf.ok ? '预检通过' : '预检未通过', { id: `preflight-${skillId}` });
    } catch (e) {
      toast.error(`预检失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 任务操作
  const handleCreateTask = async (values: any) => {
    if (!orchestrator) return;
    
    const config: ScheduleConfig = {
      strategy: values.strategy,
      interval: values.interval * 1000,
      delay: values.delay ? values.delay * 1000 : undefined,
      repeatCount: values.repeatCount,
      maxRetries: values.maxRetries || 0
    };

    const callback: TaskCallback = {
      onStart: (task, ctx) => console.log('任务开始:', task, ctx),
      onComplete: (task, result) => console.log('任务完成:', result),
      onError: (task, error) => console.error('任务错误:', error)
    };

    orchestrator.createScheduleTask({
      pluginId: values.pluginId,
      pluginType: values.pluginType,
      name: values.name,
      description: values.description,
      config,
      callback
    });

    setShowCreateTask(false);
    form.resetFields();
    await refreshData(orchestrator);
  };

  const handleStartTask = async (taskId: string) => {
    if (!orchestrator) return;
    await orchestrator.startScheduleTask(taskId);
    await refreshData(orchestrator);
  };

  const handlePauseTask = async (taskId: string) => {
    if (!orchestrator) return;
    orchestrator.pauseScheduleTask(taskId);
    await refreshData(orchestrator);
  };

  const handleCancelTask = async (taskId: string) => {
    if (!orchestrator) return;
    orchestrator.cancelScheduleTask(taskId);
    await refreshData(orchestrator);
  };

  const handleExecuteTaskNow = async (taskId: string) => {
    if (!orchestrator) return;
    try {
      await orchestrator.executeTaskNow(taskId);
      await refreshData(orchestrator);
    } catch (error) {
      console.error('执行失败:', error);
    }
  };

  // 项目主题操作
  const handleSaveTopic = (values: any) => {
    const newTopic = {
      id: editingTopic?.id || `topic-${Date.now()}`,
      name: values.name,
      description: values.description || '',
      files: topicFiles.length > 0 ? topicFiles.map(item => ({
        name: item.file.name,
        size: item.file.size,
        addedAt: item.addedAt
      })) : editingTopic?.files || [],
      instructions: editingTopic?.instructions || [],
      lastActive: Date.now()
    };

    let updatedTopics;
    if (editingTopic) {
      updatedTopics = topics.map(t => t.id === editingTopic.id ? newTopic : t);
    } else {
      updatedTopics = [...topics, newTopic];
    }

    setTopics(updatedTopics);
    persistTopicsForSkillManager(updatedTopics, (err: any) => {
      if (err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || ''))) {
        toast.error('保存项目主题失败：浏览器存储已满，请删除无用主题后重试');
      } else {
        console.error('persistTopics failed:', err);
      }
    });
    setShowTopicModal(false);
    setEditingTopic(null);
    setTopicFiles([]);
    topicForm.resetFields();
    toast.success(editingTopic ? '项目主题更新成功' : '项目主题创建成功');
  };

  const handleDeleteTopic = (topicId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此项目主题吗？相关数据将无法恢复。',
      onOk: () => {
        const updatedTopics = topics.filter(t => t.id !== topicId);
        setTopics(updatedTopics);
        persistTopicsForSkillManager(updatedTopics);
        toast.success('项目主题已删除');
      }
    });
  };

  const handleEditTopic = (topic: any) => {
    setEditingTopic(topic);
    topicForm.setFieldsValue({
      name: topic.name,
      description: topic.description
    });
    setTopicFiles([]);
    setShowTopicModal(true);
  };

  const handleAddTopic = () => {
    setEditingTopic(null);
    topicForm.resetFields();
    setTopicFiles([]);
    setShowTopicModal(true);
  };

  // 检查技能更新
  const checkSkillUpdates = (skills: any[]) => {
    const updates: Record<string, string> = {};
    
    // 模拟检查更新（实际应用中应该调用 API 或检查远程仓库）
    skills.forEach(skill => {
      // 这里简单模拟：版本号以 1.0.0 开头的技能有更新
      if (skill.version && skill.version.startsWith('1.0.')) {
        updates[skill.id] = '2.0.0'; // 模拟最新版本
      }
    });
    
    setSkillUpdates(updates);
  };

  // ==================== 技能分类和集合 ====================

  // 按分类筛选技能
  const getFilteredSkills = () => {
    let filtered = plugins.filter(p => p.type === 'skill' || p.metadata?.type === 'skill');
    
    if (activeCategory !== 'all') {
      filtered = filtered.filter(p => p.category === activeCategory);
    }
    
    if (selectedCollection) {
      const collection = collections.find(c => c.id === selectedCollection);
      if (collection) {
        filtered = filtered.filter(p => collection.skillIds.includes(p.id));
      }
    }
    
    return filtered;
  };

  // 创建集合
  const handleCreateCollection = (values: any) => {
    if (!collectionManager) return;
    
    const collection = collectionManager.createCollection(
      values.name,
      values.description,
      { icon: values.icon, color: values.color }
    );
    
    setCollections(collectionManager.getAllCollections());
    setShowCreateCollection(false);
    collectionForm.resetFields();
    toast.success('技能集合创建成功！');
  };

  // 删除集合
  const handleDeleteCollection = (collectionId: string) => {
    if (!collectionManager) return;
    
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此技能集合吗？',
      onOk: () => {
        collectionManager.deleteCollection(collectionId);
        setCollections(collectionManager.getAllCollections());
        if (selectedCollection === collectionId) {
          setSelectedCollection(null);
        }
        toast.success('技能集合已删除');
      }
    });
  };

  // 添加技能到集合
  const handleAddSkillToCollection = (skillId: string) => {
    if (!collectionManager) return;
    
    Modal.confirm({
      title: '添加到集合',
      content: (
        <Select
          placeholder="选择集合"
          style={{ width: '100%' }}
          onChange={(collectionId) => {
            if (collectionManager) {
              collectionManager.addSkillToCollection(collectionId, skillId);
              setCollections(collectionManager.getAllCollections());
              toast.success('技能已添加到集合');
            }
          }}
        >
          {collections.map(collection => (
            <Option key={collection.id} value={collection.id}>
              {collection.name}
            </Option>
          ))}
        </Select>
      ),
      onCancel: () => {}
    });
  };

  // 扫描本地技能
  const handleScanLocalSkills = async () => {
    if (!localSkillScanner) return;
    
    setScanningLocal(true);
    try {
      const sources = await localSkillScanner.scanAllDirectories();
      setLocalSkills(sources);
      toast.success(`发现 ${sources.reduce((sum, source) => sum + source.skills.length, 0)} 个本地技能`);
    } catch (error) {
      console.error('扫描本地技能失败:', error);
      toast.error('扫描本地技能失败');
    } finally {
      setScanningLocal(false);
    }
  };

  // 扫描当前工作区的 .skills 目录
  const handleScanWorkspaceSkills = async () => {
    if (!localSkillScanner) return;
    
    setScanningLocal(true);
    try {
      // 尝试通过服务器端扫描，使用当前工作目录
      const skillsPath = '/Users/yr.z/work/yuelicopilot/.skills';
      const source = await localSkillScanner.scanDirectoryViaServer(skillsPath, 'yueli');
      
      if (!source) {
        toast.error('无法扫描工作区技能目录，请确认 Skill Executor 已启动');
        return;
      }

      setLocalSkills(prev => {
        const filtered = prev.filter(s => s.platform !== 'yueli');
        return [...filtered, source];
      });
      toast.success(`在工作区发现 ${source.skills.length} 个技能`);
    } catch (error) {
      console.error('扫描工作区技能失败:', error);
      toast.error('扫描工作区技能失败');
    } finally {
      setScanningLocal(false);
    }
  };

  // 按本地绝对路径扫描技能（通过 Skill Executor 后端访问磁盘）
  const handleScanLocalPath = async (directory?: string) => {
    if (!localSkillScanner) return;

    const targetPath = (directory || localScanPath).trim();
    if (!targetPath) {
      toast.error('请输入要扫描的本地目录路径');
      return;
    }

    setScanningLocal(true);
    try {
      const source = await localSkillScanner.scanDirectoryViaServer(targetPath, 'custom');
      if (!source) {
        toast.error('无法扫描该目录，请确认 Skill Executor 已启动且路径可访问');
        return;
      }

      setLocalSkills(prev => {
        const filtered = prev.filter(s => s.directory !== source.directory);
        return [...filtered, source];
      });
      toast.success(`发现 ${source.skills.length} 个本地技能`);
    } catch (error) {
      console.error('按路径扫描本地技能失败:', error);
      toast.error('按路径扫描本地技能失败');
    } finally {
      setScanningLocal(false);
    }
  };

  // 选择自定义目录扫描
  const handleSelectCustomDirectory = async () => {
    if (!localSkillScanner) return;
    
    setScanningLocal(true);
    try {
      // 让用户选择目录
      const result = await localSkillScanner.showDirectoryPicker();
      if (!result) {
        toast.error('您的浏览器不支持目录选择，请使用 Chrome/Edge 等支持 File System Access API 的浏览器');
        return;
      }
      
      const { handle, name: directoryName } = result;
      
      // 扫描选择的目录
      const source = await localSkillScanner.scanCustomDirectory(handle, directoryName);
      
      // 将新发现的技能添加到现有列表
      setLocalSkills(prev => {
        const filtered = prev.filter(s => s.platform !== 'custom');
        return [...filtered, source];
      });
      
      toast.success(`发现 ${source.skills.length} 个本地技能`);
    } catch (error) {
      console.error('选择目录扫描失败:', error);
      toast.error('选择目录扫描失败');
    } finally {
      setScanningLocal(false);
    }
  };

  // 安装本地技能
  const handleInstallLocalSkill = async (localSkill: any, source: LocalSkillSource) => {
    if (!orchestrator) return;
    
    const pluginManager = orchestrator.getPluginManager();
    
    try {
      const manifest = localSkill.manifest || {};
      const skillId = `local_${source.platform}_${manifest.id || localSkill.id}`;
      const normalizedManifest = {
        id: skillId,
        name: localSkill.name || manifest.name || localSkill.id,
        version: manifest.version || '1.0.0',
        author: manifest.author || 'Local',
        description: manifest.description || '',
        category: manifest.category || 'other',
        tags: manifest.tags || [],
        permissions: manifest.permissions || [],
        dependencies: manifest.dependencies || [],
        tools: manifest.tools || [],
        systemPrompt: manifest.systemPrompt || manifest.prompt || manifest.instructions || ''
      };

      const metadata: PluginMetadata = {
        id: skillId,
        name: normalizedManifest.name,
        version: normalizedManifest.version,
        author: normalizedManifest.author,
        type: 'skill',
        description: normalizedManifest.description,
        dependencies: normalizedManifest.dependencies.map((dependency: string) => ({ id: dependency })),
        capabilities: normalizedManifest.tags,
        permissions: normalizedManifest.permissions,
        configuration: {},
        repository: {
          type: 'local',
          url: localSkill.path
        }
      };

      await pluginManager.installSkill(metadata.id, metadata, {
        url: localSkill.path
      });
      await pluginManager.enableSkill(metadata.id);

      const skillStorage = new SkillStorage();
      await skillStorage.save(metadata.id, {
        manifest: normalizedManifest,
        files: localSkill.files || {},
        installedAt: new Date(),
        repository: {
          type: 'local',
          url: localSkill.path
        } as any
      });

      skillExecutor?.registerSkillFromManifest(metadata.id, normalizedManifest);

      const existingHeartbeat = orchestrator
        .getPluginScheduleTasks(metadata.id)
        .find(task => task.metadata?.kind === 'heartbeat');

      if (!existingHeartbeat) {
        const heartbeatTask = orchestrator.createScheduleTask({
          pluginId: metadata.id,
          pluginType: 'skill',
          name: `${metadata.name} 心跳监控`,
          description: '同步本地技能状态并验证自动化执行闭环',
          config: {
            strategy: ScheduleStrategy.INTERVAL,
            interval: 30000
          },
          metadata: {
            kind: 'heartbeat',
            source: 'local-skill-import'
          },
          callback: {
            onComplete: () => {
              localStorage.setItem(`yueli_skill_heartbeat_${metadata.id}`, JSON.stringify({
                skillId: metadata.id,
                status: 'healthy',
                timestamp: new Date().toISOString()
              }));
            },
            onError: (_task, error) => {
              localStorage.setItem(`yueli_skill_heartbeat_${metadata.id}`, JSON.stringify({
                skillId: metadata.id,
                status: 'error',
                error: error.message,
                timestamp: new Date().toISOString()
              }));
            }
          }
        });
        await orchestrator.startScheduleTask(heartbeatTask.taskId);
      }

      orchestrator.registerStatusCallback(
        metadata.id,
        'skill',
        [PluginStatus.ENABLED, PluginStatus.EXECUTING, PluginStatus.COMPLETED, PluginStatus.FAILED, PluginStatus.ERROR],
        (state, event) => {
          localStorage.setItem(`yueli_skill_status_${metadata.id}`, JSON.stringify({
            skillId: metadata.id,
            status: state.status,
            event: event.eventName,
            timestamp: new Date().toISOString()
          }));
        }
      );
      
      await refreshData(orchestrator);
      setSkillTestResults(prev => ({
        ...prev,
        [metadata.id]: {
          success: true,
          skillId: metadata.id,
          message: '本地技能已安装、注册、启用并接入心跳监控',
          details: ['IndexedDB 已保存技能包', 'PluginManager 已注册并启用', 'SkillExecutor 已注册 manifest', '心跳任务已启动'],
          enabled: true,
          timestamp: new Date()
        }
      }));
      toast.success(`本地技能 "${metadata.name}" 安装成功！`);
    } catch (error) {
      console.error('安装本地技能失败:', error);
      toast.error('安装本地技能失败');
    }
  };

  // 打开权限管理
  const handleOpenPermissions = (skill: any) => {
    setSelectedSkillPermissions({
      skillId: skill.id,
      permissions: skill.permissions || []
    });
    setShowPermissionModal(true);
  };

  // 打开沙箱配置
  const handleOpenSandboxConfig = (skill: any) => {
    setSelectedSkillQuota({
      skillId: skill.id,
      quota: {
        maxCpu: 50,
        maxMemory: 128,
        maxDuration: 60,
        maxNetworkCalls: 10,
        maxFileReads: 50,
        maxFileWrites: 10
      }
    });
    setShowSandboxModal(true);
  };

  // 获取分类名称
  const getCategoryName = (category: SkillCategory) => {
    const names: Record<SkillCategory, string> = {
      'coding': '代码开发',
      'writing': '文本创作',
      'analysis': '数据分析',
      'automation': '任务自动化',
      'database': '数据库操作',
      'file': '文件处理',
      'web': '网页与API',
      'productivity': '生产力工具',
      'system': '系统约束',
      'other': '其他'
    };
    return names[category] || category;
  };

  // 获取分类图标
  const getCategoryIcon = (category: SkillCategory) => {
    const icons: Record<SkillCategory, string> = {
      'coding': '💻',
      'writing': '✍️',
      'analysis': '📊',
      'automation': '🤖',
      'database': '🗄️',
      'file': '📁',
      'web': '🌐',
      'productivity': '⚡',
      'system': '🔒',
      'other': '📦'
    };
    return icons[category] || '📦';
  };

  // 获取权限描述
  const getPermissionDescription = (permission: SkillPermission) => {
    const descriptions: Record<SkillPermission, string> = {
      'file.read': '读取文件',
      'file.write': '写入文件',
      'file.delete': '删除文件',
      'network.http': '发送HTTP请求',
      'network.api': '调用API接口',
      'process.execute': '执行系统命令',
      'environment.read': '读取环境变量',
      'localStorage.access': '访问本地存储',
      'notification.send': '发送通知',
      'clipboard.read': '读取剪贴板',
      'clipboard.write': '写入剪贴板'
    };
    return descriptions[permission] || permission;
  };

  // 获取权限风险等级
  const getPermissionRiskLevel = (permission: SkillPermission) => {
    const riskLevels: Partial<Record<SkillPermission, string>> = {
      'localStorage.access': '低',
      'notification.send': '低',
      'file.read': '中',
      'file.write': '中',
      'environment.read': '中',
      'clipboard.read': '中',
      'clipboard.write': '中',
      'network.http': '高',
      'network.api': '高',
      'file.delete': '高',
      'process.execute': '极高'
    };
    return riskLevels[permission] || '中';
  };

  // 处理技能更新
  const handleUpdateSkill = async (skillId: string) => {
    if (!orchestrator) return;
    
    try {
      // 显示加载状态
      toast.loading('正在更新技能...', { id: `update-${skillId}` });
      
      // 模拟更新过程
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 假设更新成功
      const pluginManager = orchestrator.getPluginManager();
      const skill = pluginManager.getSkill(skillId);
      
      if (skill) {
        // 更新版本号（实际应用中应该从服务器获取最新版本）
        skill.version = skillUpdates[skillId];
        
        // 显示更新成功
        toast.success('技能更新成功，需要重启技能', { id: `update-${skillId}` });
        
        // 提示用户重启技能
        Modal.confirm({
          title: '重启技能',
          content: '技能更新成功，请重启技能使更新生效',
          onOk: async () => {
            // 先禁用技能
            await pluginManager.disableSkill(skillId);
            // 再启用技能
            await pluginManager.enableSkill(skillId);
            toast.success('技能已重启');
            // 刷新数据
            await refreshData(orchestrator);
          }
        });
      }
    } catch (error) {
      console.error('更新技能失败:', error);
      toast.error('更新技能失败', { id: `update-${skillId}` });
    }
  };

  // 获取状态显示文本
  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      [PluginStatus.ENABLED]: '已启用',
      [PluginStatus.DISABLED]: '已禁用',
      [PluginStatus.INSTALLING]: '安装中',
      [PluginStatus.INSTALLED]: '已安装',
      [PluginStatus.EXECUTING]: '执行中',
      [PluginStatus.COMPLETED]: '已完成',
      [PluginStatus.FAILED]: '失败',
      [PluginStatus.ERROR]: '错误',
      ['schedule_pending' as const]: '待执行',
      ['schedule_running' as const]: '运行中',
      ['schedule_paused' as const]: '已暂停',
      ['schedule_completed' as const]: '已完成',
      ['schedule_cancelled' as const]: '已取消'
    };
    return statusMap[status] || status;
  };

  // 获取审计类型文本
  const getAuditTypeText = (type: string) => {
    const typeMap: Record<string, string> = {
      [AuditType.INSTALL]: '安装',
      [AuditType.UNINSTALL]: '卸载',
      [AuditType.ENABLE]: '启用',
      [AuditType.DISABLE]: '禁用',
      [AuditType.EXECUTE]: '执行',
      [AuditType.PERMISSION_UI]: '权限弹窗',
      [AuditType.CONNECT]: '连接',
      [AuditType.DISCONNECT]: '断开'
    };
    return typeMap[type] || type;
  };

  // 快速提示操作
  const handleSavePrompt = (values: any) => {
    const newPrompt = {
      id: editingPrompt?.id || values.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: values.name,
      content: values.content
    };

    let updatedPrompts;
    if (editingPrompt) {
      updatedPrompts = prompts.map(p => p.id === editingPrompt.id ? newPrompt : p);
    } else {
      updatedPrompts = [...prompts, newPrompt];
    }

    setPrompts(updatedPrompts);
    localStorage.setItem('yueli_prompts', JSON.stringify(updatedPrompts));
    setShowPromptModal(false);
    setEditingPrompt(null);
    promptForm.resetFields();
    toast.success(editingPrompt ? '快速提示更新成功' : '快速提示创建成功');
  };

  const handleDeletePrompt = (promptId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此快速提示吗？',
      onOk: () => {
        const updatedPrompts = prompts.filter(p => p.id !== promptId);
        setPrompts(updatedPrompts);
        localStorage.setItem('yueli_prompts', JSON.stringify(updatedPrompts));
        // 同时从选中的提示中移除
        const updatedSelected = selectedPrompts.filter(id => id !== promptId);
        setSelectedPrompts(updatedSelected);
        localStorage.setItem('yueli_selected_prompts', JSON.stringify(updatedSelected));
        toast.success('快速提示已删除');
      }
    });
  };

  const handleEditPrompt = (prompt: any) => {
    setEditingPrompt(prompt);
    promptForm.setFieldsValue({
      id: prompt.id,
      name: prompt.name,
      content: prompt.content
    });
    setShowPromptModal(true);
  };

  const handleAddPrompt = () => {
    setEditingPrompt(null);
    promptForm.resetFields();
    setShowPromptModal(true);
  };

  const handleTogglePromptSelection = (promptId: string) => {
    let updatedSelected;
    if (selectedPrompts.includes(promptId)) {
      updatedSelected = selectedPrompts.filter(id => id !== promptId);
    } else {
      if (selectedPrompts.length >= 6) {
        toast.error('最多只能选择6个快速提示');
        return;
      }
      updatedSelected = [...selectedPrompts, promptId];
    }
    setSelectedPrompts(updatedSelected);
    localStorage.setItem('yueli_selected_prompts', JSON.stringify(updatedSelected));
  };

  // Prompt Registry 操作
  const loadPromptRegistry = async () => {
    try {
      setPromptRegistryLoading(true);
      await promptRegistry.load();
      const allPrompts = promptRegistry.getAll();
      setPromptRegistryTemplates(allPrompts);
    } catch (error) {
      console.error('Failed to load prompt registry:', error);
      toast.error('加载Prompt失败');
    } finally {
      setPromptRegistryLoading(false);
    }
  };

  const getCategoryLabel = (category: PromptCategory) => {
    const labels: Record<PromptCategory, string> = {
      personality: '人格',
      strategy: '策略',
      action: '执行',
      tool: '工具',
      context: '上下文',
      system: '系统',
      sandbox: 'Sandbox',
      custom: '自定义'
    };
    return labels[category] || category;
  };

  const getCategoryColor = (category: PromptCategory) => {
    const colors: Record<PromptCategory, string> = {
      personality: 'purple',
      strategy: 'cyan',
      action: 'blue',
      tool: 'green',
      context: 'gold',
      system: 'orange',
      sandbox: 'red',
      custom: 'default'
    };
    return colors[category] || 'default';
  };

  const getLayerColor = (layer?: string) => {
    const colors: Record<string, string> = {
      'L1': 'red',
      'L2': 'purple',
      'L3': 'cyan'
    };
    return colors[layer || ''] || 'default';
  };

  const getFilteredPrompts = () => {
    let filtered = [...promptRegistryTemplates];
    const filterValue = activePromptCategory as string;
    
    if (filterValue !== 'all') {
      // 支持按层级筛选（L1、L2、L3）
      if (filterValue === 'L1' || filterValue === 'L2' || filterValue === 'L3') {
        filtered = filtered.filter(p => p.layer === filterValue);
      } else {
        filtered = filtered.filter(p => p.category === filterValue);
      }
    }
    
    if (searchPromptQuery) {
      const query = searchPromptQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  };

  const handleAddPromptRegistry = () => {
    setEditingPromptRegistry(null);
    promptEditForm.resetFields();
    setShowPromptEditModal(true);
  };

  const handleEditPromptRegistry = (prompt: PromptTemplate) => {
    setEditingPromptRegistry(prompt);
    promptEditForm.setFieldsValue({
      name: prompt.name,
      description: prompt.description,
      systemPrompt: prompt.systemPrompt,
      functionPrompt: prompt.functionPrompt || ''
    });
    setShowPromptEditModal(true);
  };

  const handleSavePromptRegistry = async (values: any) => {
    try {
      if (editingPromptRegistry) {
        // 编辑现有prompt
        const payload: PromptUpdatePayload = {
          name: values.name,
          description: values.description,
          systemPrompt: values.systemPrompt,
          functionPrompt: values.functionPrompt || undefined
        };
        promptRegistry.updatePrompt(editingPromptRegistry.id, payload);
        toast.success('Prompt更新成功');
      } else {
        // 创建新prompt
        const newId = values.id || `custom-${Date.now()}`;
        const category = (values.category || 'custom') as PromptCategory;
        // 根据category确定层级
        let layer: 'L1' | 'L2' | 'L3' = 'L3';
        if (category === 'system' || category === 'sandbox') {
          layer = 'L1';
        } else if (category === 'personality') {
          layer = 'L2';
        }
        promptRegistry.createPrompt({
          id: newId,
          category,
          layer,
          name: values.name,
          description: values.description,
          systemPrompt: values.systemPrompt,
          functionPrompt: values.functionPrompt || undefined,
          editable: true,
          metadata: {}
        });
        toast.success('Prompt创建成功');
      }
      
      setShowPromptEditModal(false);
      setEditingPromptRegistry(null);
      promptEditForm.resetFields();
      loadPromptRegistry();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  const handleDeletePromptRegistry = (prompt: PromptTemplate) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除Prompt "${prompt.name}" 吗？此操作无法撤销。`,
      onOk: () => {
        try {
          promptRegistry.deletePrompt(prompt.id);
          toast.success('Prompt已删除');
          loadPromptRegistry();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '删除失败');
        }
      }
    });
  };

  const handleResetPromptRegistry = (prompt: PromptTemplate) => {
    Modal.confirm({
      title: '确认重置',
      content: `确定要将Prompt "${prompt.name}" 重置为默认值吗？您的自定义修改将丢失。`,
      onOk: () => {
        try {
          promptRegistry.resetPrompt(prompt.id);
          toast.success('Prompt已重置');
          loadPromptRegistry();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '重置失败');
        }
      }
    });
  };

  const handleExportPrompts = () => {
    try {
      const prompts = promptRegistry.getAll();
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        prompts
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompts-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Prompt已导出');
    } catch (error) {
      toast.error('导出失败');
    }
  };

  const handleImportPrompts = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.prompts && Array.isArray(data.prompts)) {
          data.prompts.forEach((prompt: any) => {
            try {
              if (!promptRegistry.getPrompt(prompt.id)) {
                const category = prompt.category || 'custom';
                // 根据category确定层级，如果prompt已有layer则使用已有值
                let layer: 'L1' | 'L2' | 'L3' = prompt.layer || 'L3';
                if (!prompt.layer) {
                  if (category === 'system' || category === 'sandbox') {
                    layer = 'L1';
                  } else if (category === 'personality') {
                    layer = 'L2';
                  }
                }
                promptRegistry.createPrompt({
                  id: prompt.id,
                  category,
                  layer,
                  name: prompt.name,
                  description: prompt.description,
                  systemPrompt: prompt.systemPrompt,
                  functionPrompt: prompt.functionPrompt,
                  editable: prompt.editable ?? true,
                  metadata: prompt.metadata || {}
                });
              } else {
                promptRegistry.updatePrompt(prompt.id, {
                  name: prompt.name,
                  description: prompt.description,
                  systemPrompt: prompt.systemPrompt,
                  functionPrompt: prompt.functionPrompt
                });
              }
            } catch (error) {
              console.error(`Failed to import prompt ${prompt.id}:`, error);
            }
          });
          toast.success('Prompt导入成功');
          loadPromptRegistry();
        } else {
          toast.error('无效的导入文件格式');
        }
      } catch (error) {
        toast.error('导入失败：无法解析文件');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // 导出会话数据
  const exportSessionData = () => {
    const allKeys = Object.keys(localStorage);
    const allData: Record<string, string> = {};
    allKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        allData[key] = value;
      }
    });

    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      port: window.location.port,
      allData
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yuelicopilot-full-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`数据已导出（共 ${allKeys.length} 项）`);
  };

  // 导入会话数据
  const importSessionData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        let importedCount = 0;

        // Support both formats:
        // 1. { version, allData: {...} } - new format from exportSessionData
        // 2. { version, data: {...} } - old format from manual export
        // 3. { sessions, topics, prompts } - legacy format
        const sourceData = data.allData || data.data || data;

        if (typeof sourceData === 'object' && sourceData !== null) {
          Object.entries(sourceData).forEach(([key, value]) => {
            if (typeof value === 'string') {
              localStorage.setItem(key, value);
              importedCount++;
            }
          });
        }

        if (data.sessions || data.topics || data.prompts) {
          if (data.sessions) {
            localStorage.setItem('yueli_sessions', JSON.stringify(data.sessions));
            importedCount++;
          }
          if (data.sessionMessages) {
            localStorage.setItem('yueli_session_messages', JSON.stringify(data.sessionMessages));
            importedCount++;
          }
          if (data.topics) {
            // 导入的 topics 中如有内联 content，会被自动写入 IDB
            persistTopicsForSkillManager(data.topics);
            importedCount++;
          }
          if (data.prompts) {
            localStorage.setItem('yueli_prompts', JSON.stringify(data.prompts));
            setPrompts(data.prompts);
            importedCount++;
          }
          if (data.knowledgeBases) {
            localStorage.setItem('yueli_knowledge_bases', JSON.stringify(data.knowledgeBases));
            setKnowledgeBases(data.knowledgeBases);
            importedCount++;
          }
        }

        toast.success(`数据已导入（共 ${importedCount} 项）`);
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } catch (error) {
        toast.error('导入失败：无效的文件格式');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // 本地知识库操作
  const handleSaveKnowledge = (values: any) => {
    const newKnowledge = {
      id: editingKnowledge?.id || `knowledge-${Date.now()}`,
      name: values.name,
      description: values.description || '',
      files: knowledgeFiles.length > 0 ? knowledgeFiles : editingKnowledge?.files || [],
      createdAt: editingKnowledge?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    let updatedKnowledge;
    if (editingKnowledge) {
      updatedKnowledge = knowledgeBases.map(k => k.id === editingKnowledge.id ? newKnowledge : k);
    } else {
      updatedKnowledge = [...knowledgeBases, newKnowledge];
    }

    setKnowledgeBases(updatedKnowledge);
    localStorage.setItem('yueli_knowledge_bases', JSON.stringify(updatedKnowledge));
    setShowKnowledgeModal(false);
    setEditingKnowledge(null);
    setKnowledgeFiles([]);
    knowledgeForm.resetFields();
    toast.success(editingKnowledge ? '知识库更新成功' : '知识库创建成功');
  };

  const handleDeleteKnowledge = (knowledgeId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此知识库吗？相关文件将无法恢复。',
      onOk: () => {
        const updatedKnowledge = knowledgeBases.filter(k => k.id !== knowledgeId);
        setKnowledgeBases(updatedKnowledge);
        localStorage.setItem('yueli_knowledge_bases', JSON.stringify(updatedKnowledge));
        toast.success('知识库已删除');
      }
    });
  };

  const handleEditKnowledge = (knowledge: any) => {
    setEditingKnowledge(knowledge);
    knowledgeForm.setFieldsValue({
      name: knowledge.name,
      description: knowledge.description
    });
    setKnowledgeFiles(knowledge.files || []);
    setShowKnowledgeModal(true);
  };

  const handleAddKnowledge = () => {
    setEditingKnowledge(null);
    knowledgeForm.resetFields();
    setKnowledgeFiles([]);
    setShowKnowledgeModal(true);
  };

  const handleAddKnowledgeFile = async () => {
    try {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = '.txt,.md,.xlsx,.xls,.doc,.docx,.pdf,.png,.jpeg,.jpg,.webp,.ppt,.pptx,.html,.htm,.csv,.js,.py,.ts,.tsx,.h,.so,.json,.xml,.yaml,.yml,.css,.scss,.less,.java,.cpp,.c,.go,.rs,.php,.rb,.sh,.sql';
      fileInput.onchange = (e) => {
        const target = e.target as HTMLInputElement;
        if (target.files) {
          const newFiles = Array.from(target.files).map(file => ({
            name: file.name,
            size: file.size,
            path: file.name,
            type: file.type || 'application/octet-stream'
          }));
          
          // 检查总数是否超过100个
          if (knowledgeFiles.length + newFiles.length > 100) {
            toast.error('每个知识库最多只能包含100个文件');
            return;
          }
          
          setKnowledgeFiles(prev => [...prev, ...newFiles]);
        }
      };
      fileInput.click();
    } catch (error) {
      console.error('选择文件失败:', error);
      toast.error('选择文件失败');
    }
  };

  const handleAddKnowledgeFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const directoryHandle = await (window as any).showDirectoryPicker();
        const folderName = directoryHandle.name;
        
        const newFile = {
          name: folderName,
          size: 0,
          path: folderName,
          type: 'folder'
        };
        
        if (knowledgeFiles.length >= 100) {
          toast.error('每个知识库最多只能包含100个文件/文件夹');
          return;
        }
        
        setKnowledgeFiles(prev => [...prev, newFile]);
      } else {
        toast.error('您的浏览器不支持选择本地文件夹');
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
    }
  };

  const handleRemoveKnowledgeFile = (index: number) => {
    setKnowledgeFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 向量化预设配置
  const embeddingPresets: Record<string, any> = {
    'ollama-nomic': {
      endpoint: 'http://127.0.0.1:11434/v1/embeddings',
      model: 'nomic-embed-text:latest',
      dimension: 768,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'ollama'
    },
    'ollama-gemma': {
      endpoint: 'http://127.0.0.1:11434/v1/embeddings',
      model: 'embeddinggemma:latest',
      dimension: 768,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'ollama'
    },
    'openai': {
      endpoint: 'https://api.openai.com/v1/embeddings',
      model: 'text-embedding-3-small',
      dimension: 1536,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'openai'
    },
    'zhipu': {
      endpoint: 'https://api.zhipuai.cn/v4/embeddings',
      model: 'embedding-3',
      dimension: 2048,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'zhipu'
    },
    'gemini': {
      endpoint: 'https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent',
      model: 'text-embedding-004',
      dimension: 768,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'gemini'
    },
    'siliconflow': {
      endpoint: 'https://api.siliconflow.cn/v1/embeddings',
      model: 'BAAI/bge-m3',
      dimension: 1024,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'openai'
    },
    'deepseek': {
      endpoint: 'https://api.deepseek.com/v1/embeddings',
      model: 'text-embedding-3',
      dimension: 1536,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'openai'
    },
    'cohere': {
      endpoint: 'https://api.cohere.ai/v1/embed',
      model: 'embed-V4',
      dimension: 1536,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'cohere'
    },
    'tongyi': {
      endpoint: 'https://dashscope.aliyuncs.com/api/text-embedding-v3',
      model: 'text-embedding-V3',
      dimension: 1536,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'openai'
    },
    'together': {
      endpoint: 'https://api.together.xyz/v1/embeddings',
      model: 'togethercomputer/m2-bert-80M-8k-retrieval',
      dimension: 768,
      batchSize: 32,
      timeout: 60,
      apiKey: '',
      format: 'openai'
    }
  };

  // 预设变更处理
  const handlePresetChange = (preset: string) => {
    const config = embeddingPresets[preset];
    if (config) {
      setEmbeddingConfig({
        preset,
        ...config
      });
    }
  };

  // 保存向量化配置
  const handleSaveEmbeddingConfig = () => {
    localStorage.setItem('embeddingPreset', embeddingConfig.preset);
    localStorage.setItem('embeddingEndpoint', embeddingConfig.endpoint);
    localStorage.setItem('embeddingModel', embeddingConfig.model);
    localStorage.setItem('embeddingDimension', embeddingConfig.dimension.toString());
    localStorage.setItem('embeddingBatchSize', embeddingConfig.batchSize.toString());
    localStorage.setItem('embeddingTimeout', embeddingConfig.timeout.toString());
    localStorage.setItem('embeddingApiKey', embeddingConfig.apiKey);
    localStorage.setItem('embeddingFormat', embeddingConfig.format);
    apiService.setEmbeddingConfig(embeddingConfig);
    toast.success('向量引擎配置保存成功');
  };

  // 渲染插件卡片
  const renderPluginCard = (plugin: any) => {
    const isSkill = 'skill' in plugin || plugin.metadata?.type === 'skill';
    const type = isSkill ? 'skill' : 'connector';
    const status = plugin.status || PluginStatus.DISABLED;
    const testResult = skillTestResults[plugin.id];
    const isTestingThis = testingSkillId === plugin.id;

    return (
      <Card
        key={plugin.id || plugin.instanceId}
        size="small"
        hoverable
        actions={[
          status === PluginStatus.ENABLED || status === PluginStatus.ACTIVE ? (
            <Tooltip title="禁用">
              <ActionButton
                type="text"
                icon={<PauseCircleOutlined />}
                onClick={() => handleDisablePlugin(plugin.id || plugin.instanceId, type)}
              />
            </Tooltip>
          ) : (
            <Tooltip title="启用">
              <ActionButton
                type="text"
                icon={<PlayCircleOutlined />}
                onClick={() => handleEnablePlugin(plugin.id || plugin.instanceId, type)}
              />
            </Tooltip>
          ),
          isSkill && (
            <Tooltip title={isTestingThis ? '测试中...' : '测试技能'}>
              <ActionButton
                type="text"
                icon={isTestingThis ? <LoadingOutlined /> : <ThunderboltOutlined />}
                onClick={() => handleTestSkill(plugin.id || plugin.instanceId)}
                disabled={isTestingThis}
              />
            </Tooltip>
          ),
          isSkill && (
            <Tooltip title="预检（Mount）">
              <ActionButton
                type="text"
                icon={<CheckCircleOutlined />}
                onClick={() => handleRunPreflight(plugin.id || plugin.instanceId, true)}
              />
            </Tooltip>
          ),
          <Tooltip title="查看详情">
            <ActionButton
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setShowPluginDetail(plugin)}
            />
          </Tooltip>,
          <Tooltip title="卸载">
            <ActionButton
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleUninstallPlugin(plugin.id || plugin.instanceId, type)}
            />
          </Tooltip>
        ].filter(Boolean)}
      >
        <div style={{ marginBottom: 12 }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {plugin.name}
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {isSkill ? <AppstoreOutlined /> : <DatabaseOutlined />}
                {' '}{isSkill ? '技能' : '连接器'} · {plugin.version || '1.0.0'}
                {isSkill && skillUpdates[plugin.id] && (
                  <Button
                    type="text"
                    icon={<ArrowUpOutlined />}
                    size="small"
                    style={{ color: '#1890ff', marginLeft: 4, padding: 0 }}
                    onClick={() => handleUpdateSkill(plugin.id)}
                  />
                )}
              </div>
            </div>
            <Space direction="vertical" align="end" size={0}>
              <StatusBadge status={status}>{getStatusText(status)}</StatusBadge>
              {testResult && (
                <Tag color={testResult.success ? 'success' : 'error'} style={{ marginTop: 4 }}>
                  {testResult.success ? '测试通过' : '测试失败'}
                </Tag>
              )}
            </Space>
          </Space>
        </div>
        <p style={{ 
          fontSize: 13, 
          color: '#666', 
          margin: 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {plugin.description || '暂无描述'}
        </p>
        {plugin.metadata?.capabilities?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {plugin.metadata.capabilities.map((cap: string) => (
              <Tag key={cap} color="blue">{cap}</Tag>
            ))}
          </div>
        )}
        {isSkill && skillEvolutions[plugin.id] && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f5f7fa', borderRadius: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#333', marginBottom: 8 }}>
              <ThunderboltOutlined /> 自进化数据
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1890ff' }}>
                  {skillEvolutions[plugin.id].totalExecutions || 0}
                </div>
                <div style={{ fontSize: 10, color: '#666' }}>执行次数</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#52c41a' }}>
                  {((skillEvolutions[plugin.id].successRate || 0) * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 10, color: '#666' }}>成功率</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#faad14' }}>
                  {(skillEvolutions[plugin.id].avgDurationMs || 0) / 1000}s
                </div>
                <div style={{ fontSize: 10, color: '#666' }}>平均耗时</div>
              </div>
            </div>
          </div>
        )}
        {testResult?.errors && testResult.errors.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f5222d' }}>
            错误: {testResult.errors[0]}
          </div>
        )}
      </Card>
    );
  };

  // 渲染任务卡片
  const renderTaskCard = (task: any) => {
    return (
      <Card
        key={task.taskId}
        size="small"
        hoverable
        actions={[
          task.status === ScheduleStatus.PENDING || task.status === ScheduleStatus.PAUSED ? (
            <Tooltip title="启动">
              <ActionButton
                type="text"
                icon={<PlayCircleOutlined />}
                onClick={() => handleStartTask(task.taskId)}
              />
            </Tooltip>
          ) : task.status === ScheduleStatus.RUNNING ? (
            <Tooltip title="暂停">
              <ActionButton
                type="text"
                icon={<PauseCircleOutlined />}
                onClick={() => handlePauseTask(task.taskId)}
              />
            </Tooltip>
          ) : null,
          <Tooltip title="立即执行">
            <ActionButton
              type="text"
              icon={<ThunderboltOutlined />}
              onClick={() => handleExecuteTaskNow(task.taskId)}
            />
          </Tooltip>,
          <Tooltip title="取消">
            <ActionButton
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleCancelTask(task.taskId)}
            />
          </Tooltip>
        ].filter(Boolean)}
      >
        <div style={{ marginBottom: 12 }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {task.name}
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                <ClockCircleOutlined /> {task.pluginType} · {task.pluginId}
              </div>
            </div>
            <StatusBadge status={task.status}>{getStatusText(task.status)}</StatusBadge>
          </Space>
        </div>
        {task.description && (
          <p style={{ fontSize: 13, color: '#666', margin: 0, marginBottom: 12 }}>
            {task.description}
          </p>
        )}
        <Descriptions column={1} size="small" style={{ fontSize: 12 }}>
          <Descriptions.Item label="策略">
            {task.config.strategy}
          </Descriptions.Item>
          {task.config.interval && (
            <Descriptions.Item label="间隔">
              {task.config.interval / 1000}秒
            </Descriptions.Item>
          )}
          <Descriptions.Item label="执行次数">
            {task.executionCount}次
          </Descriptions.Item>
          {task.lastExecuteTime && (
            <Descriptions.Item label="上次执行">
              {new Date(task.lastExecuteTime).toLocaleTimeString()}
            </Descriptions.Item>
          )}
          {task.nextExecuteTime && (
            <Descriptions.Item label="下次执行">
              {new Date(task.nextExecuteTime).toLocaleTimeString()}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>
    );
  };

  // 渲染本地技能卡片
  const renderLocalSkillCard = (localSkill: any, source: LocalSkillSource) => {
    const isInstalled = plugins.some(p => p.id === localSkill.id);
    
    return (
      <Card
        key={`${source.platform}-${localSkill.id}`}
        size="small"
        hoverable
        actions={isInstalled ? [] : [
          <Tooltip title="安装">
            <ActionButton
              type="text"
              icon={<DownloadOutlined />}
              onClick={() => handleInstallLocalSkill(localSkill, source)}
            />
          </Tooltip>
        ]}
      >
        <div style={{ marginBottom: 8 }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                {localSkill.name}
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>
                <FolderOutlined /> {source.platform}
              </div>
            </div>
            {isInstalled ? (
              <Tag color="green">已安装</Tag>
            ) : (
              <Tag color="orange">未安装</Tag>
            )}
          </Space>
        </div>
        {localSkill.manifest?.description && (
          <p style={{ 
            fontSize: 12, 
            color: '#666', 
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {localSkill.manifest.description}
          </p>
        )}
      </Card>
    );
  };

  if (loading) {
    return (
      <Container>
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          加载中...
        </div>
      </Container>
    );
  }

  return (
    <Container>
      {/* 顶部Header */}
      <Header>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button 
            icon={<ArrowLeftOutlined />} 
            onClick={() => navigate('/')}
            style={{ 
              background: '#fff', 
              border: '1px solid #d9d9d9',
              color: '#333',
              borderRadius: '4px'
            }}
          >
            返回
          </Button>
          <Title>
            <SettingOutlined />
            技能与任务管理中心
          </Title>
        </div>
        <StatsContainer>
          <Statistic 
            title={<span style={{ color: '#666' }}>技能总数</span>}
            value={plugins.length}
            valueStyle={{ color: '#1890ff' }}
          />
          <Statistic 
            title={<span style={{ color: '#666' }}>运行任务</span>}
            value={tasks.filter(t => t.status === ScheduleStatus.RUNNING).length}
            valueStyle={{ color: '#52c41a' }}
          />
          <Statistic 
            title={<span style={{ color: '#666' }}>审计记录</span>}
            value={auditLogs.length}
            valueStyle={{ color: '#faad14' }}
          />
          <Statistic 
            title={<span style={{ color: '#666' }}>活跃用户</span>}
            value={profileLoading ? '...' : (profileStats?.totalUsers || 0)}
            valueStyle={{ color: '#722ed1' }}
          />
          <Statistic 
            title={<span style={{ color: '#666' }}>交互次数</span>}
            value={profileLoading ? '...' : (profileStats?.totalInteractions || 0)}
            valueStyle={{ color: '#eb2f96' }}
          />
        </StatsContainer>
      </Header>

      {/* Tab导航栏 */}
      <div style={{ 
        background: '#fff', 
        borderBottom: '1px solid #e8e8e8',
        padding: '0 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          type="card"
          style={{ flex: 1 }}
        >
          <Tabs.TabPane key="plugins" tab={<span><AppstoreOutlined /> 技能管理</span>} />
          <Tabs.TabPane key="tasks" tab={<span><ClockCircleOutlined /> 任务管理</span>} />
          <Tabs.TabPane key="audit" tab={<span><AuditOutlined /> 审计日志</span>} />
          <Tabs.TabPane key="sandbox" tab={<span><FolderOpenOutlined /> Sandbox 浏览器</span>} />
          <Tabs.TabPane key="knowledge" tab={<span><DatabaseOutlined /> 项目主题知识库</span>} />
          <Tabs.TabPane key="prompts" tab={<span><ThunderboltOutlined /> 快速提示</span>} />
          <Tabs.TabPane key="prompt-registry" tab={<span><InfoCircleOutlined /> Prompt管理</span>} />
          <Tabs.TabPane key="mcp" tab={<span><DatabaseOutlined /> MCP 连接器</span>} />
          <Tabs.TabPane key="config" tab={<span><SettingOutlined /> 配置管理</span>} />
          <Tabs.TabPane key="yueli-copilot" tab={<span><InfoCircleOutlined /> YueliCopilot 设置</span>} />
        </Tabs>
        
        {/* 全局导入导出按钮 */}
        <Space style={{ marginLeft: 16 }}>
          <Button 
            icon={<UploadOutlined />}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  importSessionData({ target: { files: [file], value: '' } } as any);
                }
              };
              input.click();
            }}
          >
            导入数据
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportSessionData}>
            导出数据
          </Button>
        </Space>
      </div>

      {/* 内容区域 */}
      <Content style={{ padding: '24px', background: '#f5f5f5', minHeight: 'calc(100vh - 180px)' }}>
        {/* 技能管理 */}
        {activeTab === 'plugins' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Select
                  value={activeCategory}
                  onChange={setActiveCategory}
                  style={{ width: 160 }}
                  placeholder="按分类筛选"
                >
                  <Option value="all">全部分类</Option>
                  <Option value="coding">代码开发</Option>
                  <Option value="writing">文本创作</Option>
                  <Option value="analysis">数据分析</Option>
                  <Option value="automation">任务自动化</Option>
                  <Option value="database">数据库操作</Option>
                  <Option value="file">文件处理</Option>
                  <Option value="web">网页与API</Option>
                  <Option value="productivity">生产力工具</Option>
                  <Option value="other">其他</Option>
                </Select>
                <Select
                  value={selectedCollection}
                  onChange={setSelectedCollection}
                  style={{ width: 160 }}
                  placeholder="按集合筛选"
                >
                  <Option value={null}>全部集合</Option>
                  {collections.map(collection => (
                    <Option key={collection.id} value={collection.id}>
                      {collection.name}
                    </Option>
                  ))}
                </Select>
              </Space>
              <Space>
                <Button icon={<AppstoreOutlined />} onClick={handleScanWorkspaceSkills} loading={scanningLocal}>
                  扫描工作区技能
                </Button>
                <Button icon={<ScanOutlined />} onClick={handleScanLocalSkills} loading={scanningLocal}>
                  扫描本地技能
                </Button>
                <Button icon={<FolderOpenOutlined />} onClick={handleSelectCustomDirectory}>
                  选择目录扫描
                </Button>
                <Button icon={<FolderOpenOutlined />} onClick={() => setShowCreateCollection(true)}>
                  技能集合
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowInstallModal(true)}>
                  安装技能
                </Button>
              </Space>
            </div>
            
            {/* 用户偏好统计卡片 */}
            <div style={{ marginBottom: 24 }}>
              <Card 
                title={<span><ThunderboltOutlined /> 用户偏好分析</span>} 
                bordered={false}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              >
                <div style={{ display: 'flex', gap: 24 }}>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600, color: '#333' }}>全局统计</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                      <div style={{ textAlign: 'center', padding: 12, background: '#f5f7fa', borderRadius: 8 }}>
                        <div style={{ fontSize: 24, fontWeight: 600, color: '#722ed1' }}>
                          {profileLoading ? '...' : (profileStats?.totalUsers || 0)}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>总用户数</div>
                      </div>
                      <div style={{ textAlign: 'center', padding: 12, background: '#f5f7fa', borderRadius: 8 }}>
                        <div style={{ fontSize: 24, fontWeight: 600, color: '#eb2f96' }}>
                          {profileLoading ? '...' : (profileStats?.totalInteractions || 0)}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>交互次数</div>
                      </div>
                      <div style={{ textAlign: 'center', padding: 12, background: '#f5f7fa', borderRadius: 8 }}>
                        <div style={{ fontSize: 24, fontWeight: 600, color: '#52c41a' }}>
                          {profileLoading ? '...' : ((profileStats?.avgSuccessRate || 0) * 100).toFixed(0)}%
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>平均成功率</div>
                      </div>
                      <div style={{ textAlign: 'center', padding: 12, background: '#f5f7fa', borderRadius: 8 }}>
                        <div style={{ fontSize: 24, fontWeight: 600, color: '#1890ff' }}>
                          {profileLoading ? '...' : (profileStats?.topSkills?.length || 0)}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>热门技能数</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600, color: '#333' }}>热门技能排行</h4>
                    <List
                      dataSource={profileStats?.topSkills || []}
                      renderItem={(item: any, index: number) => (
                        <List.Item style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <Tag color={index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : 'default'}>
                              {index + 1}
                            </Tag>
                            <span style={{ fontSize: 14, color: '#333' }}>{item.skillId}</span>
                          </div>
                          <span style={{ fontSize: 14, color: '#666' }}>{item.count} 次使用</span>
                        </List.Item>
                      )}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600, color: '#333' }}>我的常用技能</h4>
                    <List
                      dataSource={userTopSkills}
                      renderItem={(item: any, index: number) => (
                        <List.Item style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <Tag color="blue">{index + 1}</Tag>
                            <span style={{ fontSize: 14, color: '#333' }}>{item.skillName || item.skillId}</span>
                          </div>
                          <span style={{ fontSize: 12, color: '#1890ff' }}>评分: {item.score?.toFixed(2) || '0'}</span>
                        </List.Item>
                      )}
                    />
                    {userTopSkills.length === 0 && (
                      <div style={{ textAlign: 'center', color: '#999', padding: 16 }}>
                        暂无常用技能数据
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
            
            {/* 显示已安装的技能 */}
            {getFilteredSkills().length === 0 ? (
              <Empty description="暂无技能，点击上方按钮安装" />
            ) : (
              <CardGrid>
                {getFilteredSkills().map(renderPluginCard)}
              </CardGrid>
            )}
            
            {/* 本地技能扫描结果 */}
            {localSkills.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>发现的本地技能</h4>
                <CardGrid>
                  {localSkills.flatMap(source => 
                    source.skills.map(localSkill => renderLocalSkillCard(localSkill, source))
                  )}
                </CardGrid>
              </div>
            )}
          </div>
        )}
        
        {/* 任务管理 */}
        {activeTab === 'tasks' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={() => orchestrator && refreshData(orchestrator)}>
                  刷新
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateTask(true)}>
                  创建任务
                </Button>
              </Space>
            </div>
            
            {/* 运行中的任务 */}
            {tasks.filter(t => t.status === ScheduleStatus.RUNNING).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>运行中的任务</h4>
                <CardGrid>
                  {tasks.filter(t => t.status === ScheduleStatus.RUNNING).map(renderTaskCard)}
                </CardGrid>
              </div>
            )}
            
            {/* 所有定时任务 */}
            <div>
              <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>定时任务列表</h4>
              {tasks.length === 0 ? (
                <Empty description="暂无定时任务" />
              ) : (
                <CardGrid>
                  {tasks.map(renderTaskCard)}
                </CardGrid>
              )}
            </div>
          </div>
        )}
        
        {/* 审计日志 */}
        {activeTab === 'audit' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Button icon={<ReloadOutlined />} onClick={() => orchestrator && refreshData(orchestrator)}>
                刷新
              </Button>
            </div>

            {/* 运行中的执行（inflight） */}
            <Divider orientation="left">运行中（实时）</Divider>
            {inflightExecutions.length === 0 ? (
              <Empty description="当前没有运行中的技能执行" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                size="small"
                bordered
                dataSource={inflightExecutions}
                style={{ marginBottom: 24 }}
                renderItem={(item: any) => (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ fontWeight: 600 }}>
                          <Spin size="small" style={{ marginRight: 8 }} />
                          {item.skillId || '-'}{' '}
                          <Tag color="processing">{item.evt || 'running'}</Tag>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#999', marginLeft: 8 }}>
                            {item.execId}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#666' }}>
                          已运行 {Math.round((item.elapsedSoFarMs || 0) / 1000)}s
                        </div>
                      </div>
                      {(item.entrypoint || item.script) && (
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4, wordBreak: 'break-all' }}>
                          {String(item.entrypoint || item.script)}
                        </div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            )}

            <Divider orientation="left">技能执行审计（服务端）</Divider>
            {(() => {
              const finished = skillExecutions
                .filter((it: any) => !String(it?.evt || '').endsWith('.started'))
                .slice()
                .reverse();
              if (finished.length === 0) {
                return <Empty description="暂无技能执行审计（请确认 skill-executor 已启动）" />;
              }
              const items = finished.map((item: any, index: number) => {
                const key = String(item.execId || `${item.ts}-${index}`);
                const failed = item.ok === false || (typeof item.exitCode === 'number' && item.exitCode !== 0);
                const artifacts: any[] = Array.isArray(item.artifacts) ? item.artifacts : [];
                const log = item.execId ? executionLogs[item.execId] : null;
                const isLoadingLog = item.execId ? !!loadingLogs[item.execId] : false;
                return {
                  key,
                  label: (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontWeight: 600 }}>
                        {item.skillId || item.skill_id || '-'}{' '}
                        <Tag color={failed ? 'error' : 'success'}>
                          {item.evt || 'execution'}
                        </Tag>
                        {typeof item.exitCode === 'number' && (
                          <Tag color={item.exitCode === 0 ? 'default' : 'red'}>
                            exit {item.exitCode}
                          </Tag>
                        )}
                        {artifacts.length > 0 && (
                          <Tag color="blue" icon={<FileOutlined />}>
                            {artifacts.length} 产物
                          </Tag>
                        )}
                        {item.execId && (
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#999', marginLeft: 8 }}>
                            {item.execId}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        {item.ts ? new Date(item.ts).toLocaleString() : ''}
                        {typeof item.elapsed_ms === 'number' ? ` · ${item.elapsed_ms}ms` : ''}
                      </div>
                    </div>
                  ),
                  children: (
                    <div>
                      {(item.entrypoint || item.script) && (
                        <div style={{ fontSize: 12, color: '#666', marginBottom: 8, wordBreak: 'break-all' }}>
                          脚本：{String(item.entrypoint || item.script)}
                        </div>
                      )}
                      {item.stderrSnippet && (
                        <div style={{ fontSize: 12, color: '#f5222d', marginBottom: 8 }}>
                          stderr 摘要：{String(item.stderrSnippet)}
                        </div>
                      )}

                      {/* 产物列表 */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                          产物 (artifacts)
                        </div>
                        {artifacts.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#999' }}>此次执行未在 /outputs 目录生成新文件</div>
                        ) : (
                          <Table
                            size="small"
                            pagination={false}
                            rowKey={(r: any) => r.name}
                            dataSource={artifacts}
                            columns={[
                              {
                                title: '名称',
                                dataIndex: 'name',
                                render: (name: string, row: any) => (
                                  <Space>
                                    <FileOutlined />
                                    <a
                                      href={`${resolveSkillExecutorBaseUrl()}${row.url}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {name}
                                    </a>
                                  </Space>
                                )
                              },
                              {
                                title: '大小',
                                dataIndex: 'bytes',
                                width: 110,
                                render: (b: number) => {
                                  if (!Number.isFinite(b)) return '-';
                                  if (b < 1024) return `${b} B`;
                                  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
                                  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
                                }
                              },
                              { title: 'MIME', dataIndex: 'mime', width: 200 },
                              {
                                title: '操作',
                                width: 100,
                                render: (_: any, row: any) => (
                                  <Button
                                    size="small"
                                    type="link"
                                    icon={<DownloadOutlined />}
                                    href={`${resolveSkillExecutorBaseUrl()}${row.url}`}
                                    target="_blank"
                                  >
                                    下载
                                  </Button>
                                )
                              }
                            ]}
                          />
                        )}
                      </div>

                      {/* 完整日志（懒加载） */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>完整日志 (stdout / stderr)</span>
                          {item.execId && (
                            <Button
                              size="small"
                              icon={<EyeOutlined />}
                              loading={isLoadingLog}
                              onClick={() => loadExecutionLog(item.execId)}
                              disabled={!!log}
                            >
                              {log ? '已加载' : '加载日志'}
                            </Button>
                          )}
                        </div>
                        {!item.execId && (
                          <div style={{ fontSize: 12, color: '#999' }}>此审计无 execId（旧记录）</div>
                        )}
                        {log?.error && (
                          <div style={{ fontSize: 12, color: '#f5222d' }}>加载失败：{String(log.error)}</div>
                        )}
                        {log && !log.error && (
                          <Tabs
                            size="small"
                            defaultActiveKey="stdout"
                            items={[
                              {
                                key: 'stdout',
                                label: `stdout (${(log.stdout || '').length})`,
                                children: (
                                  <pre style={{
                                    background: '#0b1021',
                                    color: '#e6e6e6',
                                    padding: 12,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    maxHeight: 320,
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                  }}>{String(log.stdout || '(empty)')}</pre>
                                )
                              },
                              {
                                key: 'stderr',
                                label: `stderr (${(log.stderr || '').length})`,
                                children: (
                                  <pre style={{
                                    background: '#2a0e0e',
                                    color: '#ffb3b3',
                                    padding: 12,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    maxHeight: 320,
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all'
                                  }}>{String(log.stderr || '(empty)')}</pre>
                                )
                              },
                              {
                                key: 'raw',
                                label: '原始 JSON',
                                children: (
                                  <pre style={{
                                    background: '#fafafa',
                                    padding: 12,
                                    borderRadius: 4,
                                    fontSize: 12,
                                    maxHeight: 320,
                                    overflow: 'auto'
                                  }}>{JSON.stringify(log, null, 2)}</pre>
                                )
                              }
                            ]}
                          />
                        )}
                      </div>
                    </div>
                  )
                };
              });
              return (
                <Collapse
                  size="small"
                  accordion
                  activeKey={expandedExecKeys}
                  onChange={(keys) => {
                    const arr = Array.isArray(keys) ? keys : [keys].filter(Boolean) as string[];
                    setExpandedExecKeys(arr);
                    const last = arr[arr.length - 1];
                    if (last) {
                      const target = finished.find((it: any) =>
                        String(it.execId || '') === last ||
                        String(`${it.ts}-${finished.indexOf(it)}`) === last
                      );
                      if (target?.execId) loadExecutionLog(target.execId);
                    }
                  }}
                  items={items}
                  style={{ marginBottom: 24 }}
                />
              );
            })()}
            
            {auditLogs.length === 0 ? (
              <Empty description="暂无审计日志" />
            ) : (
              <Timeline
                items={auditLogs.map((log, index) => ({
                  key: log.id || index,
                  color: log.status === 'success' ? 'green' : 'red',
                  children: (
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {getAuditTypeText(log.type)} {log.pluginId}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        状态: {log.status === 'success' ? '成功' : '失败'}
                        {log.duration && ` · 耗时: ${log.duration}ms`}
                        {` · ${new Date(log.timestamp).toLocaleString()}`}
                      </div>
                      {log.outputs && (
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                          输出: {JSON.stringify(log.outputs)}
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        )}

        {/* Sandbox 浏览器 */}
        {activeTab === 'sandbox' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: '#666' }}>
                <span style={{ fontWeight: 600, marginRight: 8 }}>沙箱根目录：</span>
                <code style={{ fontSize: 12 }}>{sandboxRoot || '加载中...'}</code>
              </div>
              <Space>
                <Button
                  icon={<RollbackOutlined />}
                  onClick={() => loadSandboxDir('/')}
                  disabled={sandboxLoading}
                >
                  回到根目录
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => loadSandboxDir(sandboxPath)}
                  loading={sandboxLoading}
                >
                  刷新
                </Button>
              </Space>
            </div>

            {/* 路径面包屑 */}
            <Breadcrumb
              style={{ marginBottom: 16 }}
              items={(() => {
                const segments = sandboxPath.split('/').filter(Boolean);
                const crumbs: Array<{ title: React.ReactNode }> = [{
                  title: (
                    <a onClick={() => loadSandboxDir('/')}>
                      <FolderOpenOutlined /> /
                    </a>
                  )
                }];
                let acc = '';
                segments.forEach((seg) => {
                  acc += `/${seg}`;
                  const here = acc;
                  crumbs.push({
                    title: <a onClick={() => loadSandboxDir(here)}>{seg}</a>
                  });
                });
                return crumbs;
              })()}
            />

            {sandboxError && (
              <div style={{ color: '#f5222d', marginBottom: 12 }}>{sandboxError}</div>
            )}

            <Row gutter={16}>
              <Col xs={24} lg={sandboxFile ? 12 : 24}>
                <Table
                  size="small"
                  rowKey="name"
                  loading={sandboxLoading}
                  pagination={{ pageSize: 50, hideOnSinglePage: true }}
                  dataSource={sandboxEntries}
                  locale={{ emptyText: <Empty description="此目录为空" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                  columns={[
                    {
                      title: '名称',
                      dataIndex: 'name',
                      render: (name: string, row: any) => (
                        <Space>
                          {row.type === 'directory' ? <FolderOutlined /> : <FileOutlined />}
                          {row.type === 'directory' ? (
                            <a onClick={() => loadSandboxDir(`${sandboxPath === '/' ? '' : sandboxPath}/${name}`)}>
                              {name}
                            </a>
                          ) : (
                            <a onClick={() => loadSandboxFile(`${sandboxPath === '/' ? '' : sandboxPath}/${name}`)}>
                              {name}
                            </a>
                          )}
                        </Space>
                      )
                    },
                    {
                      title: '类型',
                      dataIndex: 'type',
                      width: 90,
                      render: (t: string) => <Tag color={t === 'directory' ? 'blue' : 'default'}>{t}</Tag>
                    },
                    {
                      title: '大小',
                      dataIndex: 'size',
                      width: 110,
                      render: (b?: number, row?: any) => {
                        if (row?.type === 'directory') return '-';
                        if (!Number.isFinite(b)) return '-';
                        const n = b as number;
                        if (n < 1024) return `${n} B`;
                        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
                        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
                      }
                    },
                    {
                      title: '修改时间',
                      dataIndex: 'mtime',
                      width: 180,
                      render: (m?: string) => m ? new Date(m).toLocaleString() : '-'
                    }
                  ]}
                />
              </Col>
              {sandboxFile && (
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    title={
                      <Space>
                        <FileOutlined />
                        <span>{sandboxFile.name}</span>
                        <Tag>{sandboxFile.size} B</Tag>
                      </Space>
                    }
                    extra={
                      <Button size="small" type="text" onClick={() => setSandboxFile(null)}>
                        关闭
                      </Button>
                    }
                  >
                    {sandboxFileLoading ? (
                      <div style={{ textAlign: 'center', padding: 24 }}>
                        <Spin />
                      </div>
                    ) : (
                      <pre style={{
                        margin: 0,
                        background: '#0b1021',
                        color: '#e6e6e6',
                        padding: 12,
                        borderRadius: 4,
                        fontSize: 12,
                        maxHeight: 480,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all'
                      }}>{sandboxFile.content || '(空文件)'}</pre>
                    )}
                  </Card>
                </Col>
              )}
            </Row>
          </div>
        )}

        {/* 项目主题知识库管理 */}
        {activeTab === 'knowledge' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddKnowledge}>
                添加知识库
              </Button>
            </div>
            
            {/* 合并显示项目主题和本地知识库 */}
            {topics.length === 0 && knowledgeBases.length === 0 ? (
              <Empty description="暂无知识库" />
            ) : (
              <div>
                {/* 项目主题（知识库类型） */}
                {topics.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>项目主题</h4>
                    <CardGrid>
                      {topics.map((topic) => (
                        <Card
                          key={`topic-${topic.id}`}
                          size="small"
                          hoverable
                          actions={[
                            <Tooltip title="编辑">
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                onClick={() => handleEditTopic(topic)}
                              />
                            </Tooltip>,
                            <Tooltip title="删除">
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteTopic(topic.id)}
                              />
                            </Tooltip>
                          ]}
                        >
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                              {topic.name}
                            </div>
                            <div style={{ fontSize: 12, color: '#888' }}>
                              {topic.files?.length || 0} 个文件
                            </div>
                          </div>
                          {topic.description && (
                            <p style={{ fontSize: 13, color: '#666', margin: 0, marginBottom: 8 }}>
                              {topic.description}
                            </p>
                          )}
                          {topic.files?.length > 0 && (
                            <div style={{ fontSize: 12, color: '#666' }}>
                              <div style={{ marginBottom: 4 }}>文件列表:</div>
                              <div style={{ maxHeight: 100, overflow: 'auto' }}>
                                {topic.files.slice(0, 5).map((file: { name: string; size: number }, index: number) => (
                                  <div key={index} style={{ marginBottom: 2 }}>
                                    {file.name} ({file.size} bytes)
                                  </div>
                                ))}
                                {topic.files.length > 5 && (
                                  <div style={{ marginTop: 4, color: '#999' }}>
                                    ... 还有 {topic.files.length - 5} 个文件
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Card>
                      ))}
                    </CardGrid>
                  </div>
                )}
                
                {/* 本地知识库 */}
                {knowledgeBases.length > 0 && (
                  <div>
                    <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>本地知识库</h4>
                    <CardGrid>
                      {knowledgeBases.map((knowledge) => (
                        <Card
                          key={`knowledge-${knowledge.id}`}
                          size="small"
                          hoverable
                          actions={[
                            <Tooltip title="编辑">
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                onClick={() => handleEditKnowledge(knowledge)}
                              />
                            </Tooltip>,
                            <Tooltip title="删除">
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteKnowledge(knowledge.id)}
                              />
                            </Tooltip>
                          ]}
                        >
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                              {knowledge.name}
                            </div>
                            <div style={{ fontSize: 12, color: '#888' }}>
                              {knowledge.files?.length || 0} 个文件/文件夹
                            </div>
                          </div>
                          {knowledge.description && (
                            <p style={{ fontSize: 13, color: '#666', margin: 0, marginBottom: 8 }}>
                              {knowledge.description}
                            </p>
                          )}
                          {knowledge.files?.length > 0 && (
                            <div style={{ fontSize: 12, color: '#666' }}>
                              <div style={{ marginBottom: 4 }}>文件/文件夹列表:</div>
                              <div style={{ maxHeight: 100, overflow: 'auto' }}>
                                {knowledge.files.slice(0, 5).map((file: { type: string; name: string; size: number }, index: number) => (
                                  <div key={index} style={{ marginBottom: 2 }}>
                                    {file.type === 'folder' ? <FolderOutlined /> : <FileOutlined />}
                                    {' '}{file.name} {file.size > 0 && `(${file.size} bytes)`}
                                  </div>
                                ))}
                                {knowledge.files.length > 5 && (
                                  <div style={{ marginTop: 4, color: '#888' }}>
                                    还有 {knowledge.files.length - 5} 个文件/文件夹
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Card>
                      ))}
                    </CardGrid>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* 快速提示 */}
        {activeTab === 'prompts' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddPrompt}>
                添加快速提示
              </Button>
            </div>
            
            {prompts.length === 0 ? (
              <Empty description="暂无快速提示" />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {prompts.map((prompt: any) => (
                  <Card
                    key={prompt.id}
                    size="small"
                    style={{ 
                      width: 280,
                      borderColor: selectedPrompts.includes(prompt.id) ? '#1890ff' : '#e8e8e8',
                      backgroundColor: selectedPrompts.includes(prompt.id) ? '#e6f7ff' : 'white'
                    }}
                    actions={[
                      <Tooltip title="编辑">
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => handleEditPrompt(prompt)}
                        />
                      </Tooltip>,
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDeletePrompt(prompt.id)}
                        />
                      </Tooltip>
                    ]}
                  >
                    <div onClick={() => handleTogglePromptSelection(prompt.id)} style={{ cursor: 'pointer' }}>
                      <Checkbox 
                        checked={selectedPrompts.includes(prompt.id)}
                        onChange={() => handleTogglePromptSelection(prompt.id)}
                        style={{ marginRight: 8 }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{prompt.name}</span>
                    </div>
                    <p style={{ fontSize: 12, color: '#666', margin: '8px 0 0 0', paddingLeft: 24 }}>
                      {prompt.content}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Prompt管理 */}
        {activeTab === 'prompt-registry' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <Space>
                <Select
                  value={activePromptCategory}
                  onChange={setActivePromptCategory}
                  style={{ width: 180 }}
                  placeholder="按分类筛选"
                >
                  <Option value="all">全部分类</Option>
                  <Option value="L1">L1 - 系统层</Option>
                  <Option value="L2">L2 - 人格层</Option>
                  <Option value="L3">L3 - 技能/工具层</Option>
                  <Option value="personality">人格 (Personality)</Option>
                  <Option value="skill">技能 (Skill)</Option>
                  <Option value="tool">工具 (Tool)</Option>
                  <Option value="system">系统配置 (System)</Option>
                  <Option value="sandbox">Sandbox (L1)</Option>
                  <Option value="custom">自定义 (Custom)</Option>
                </Select>
                <Input
                  placeholder="搜索Prompt..."
                  value={searchPromptQuery}
                  onChange={(e) => setSearchPromptQuery(e.target.value)}
                  style={{ width: 240 }}
                  prefix={<InfoCircleOutlined />}
                />
              </Space>
              <Space>
                <Button icon={<ReloadOutlined />} onClick={loadPromptRegistry}>
                  刷新
                </Button>
                <Button icon={<UploadOutlined />} onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.json';
                  input.onchange = (e: Event) => {
                    const target = e.target as HTMLInputElement;
                    handleImportPrompts({ target } as React.ChangeEvent<HTMLInputElement>);
                  };
                  input.click();
                }}>
                  导入
                </Button>
                <Button icon={<DownloadOutlined />} onClick={handleExportPrompts}>
                  导出
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={handleAddPromptRegistry}>
                  新建Prompt
                </Button>
              </Space>
            </div>

            {/* 三层架构概览卡片 */}
            <Card style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 16, fontSize: 14, fontWeight: 600, color: '#333' }}>
                📐 三层架构概览
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <div style={{ 
                    background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)', 
                    borderRadius: '8px', 
                    padding: '16px',
                    color: '#fff'
                  }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>L1 - 全局系统层</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>
                      {promptRegistryTemplates.filter(p => p.layer === 'L1').length}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                      安全策略、Sandbox、系统配置
                    </div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ 
                    background: 'linear-gradient(135deg, #6c5ce7 0%, #5b4cdb 100%)', 
                    borderRadius: '8px', 
                    padding: '16px',
                    color: '#fff'
                  }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>L2 - 角色/人格层</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>
                      {promptRegistryTemplates.filter(p => p.layer === 'L2').length}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                      人格定义、记忆集成、行为规则
                    </div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ 
                    background: 'linear-gradient(135deg, #00cec9 0%, #00b894 100%)', 
                    borderRadius: '8px', 
                    padding: '16px',
                    color: '#fff'
                  }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>L3 - 任务/技能层</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>
                      {promptRegistryTemplates.filter(p => p.layer === 'L3').length}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
                      技能Prompt、工具调用、具体任务
                    </div>
                  </div>
                </Col>
              </Row>
            </Card>

            {/* 分类统计 */}
            <Card style={{ marginBottom: 24 }}>
              <Row gutter={16}>
                <Col span={4}>
                  <Statistic 
                    title="全部Prompt" 
                    value={promptRegistryTemplates.length} 
                    valueStyle={{ color: '#1890ff' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="人格" 
                    value={promptRegistryTemplates.filter(p => p.category === 'personality').length} 
                    valueStyle={{ color: '#722ed1' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="策略" 
                    value={promptRegistryTemplates.filter(p => p.category === 'strategy').length} 
                    valueStyle={{ color: '#13c2c2' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="执行" 
                    value={promptRegistryTemplates.filter(p => p.category === 'action').length} 
                    valueStyle={{ color: '#1890ff' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="工具" 
                    value={promptRegistryTemplates.filter(p => p.category === 'tool').length} 
                    valueStyle={{ color: '#52c41a' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="上下文" 
                    value={promptRegistryTemplates.filter(p => p.category === 'context').length} 
                    valueStyle={{ color: '#faad14' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="系统" 
                    value={promptRegistryTemplates.filter(p => p.category === 'system').length} 
                    valueStyle={{ color: '#fa8c16' }} 
                  />
                </Col>
                <Col span={4}>
                  <Statistic 
                    title="自定义" 
                    value={promptRegistryTemplates.filter(p => p.category === 'custom').length} 
                    valueStyle={{ color: '#666' }} 
                  />
                </Col>
              </Row>
            </Card>

            {/* Prompt列表 */}
            {promptRegistryLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <LoadingOutlined style={{ fontSize: '24px', marginBottom: '16px' }} />
                <div>加载中...</div>
              </div>
            ) : getFilteredPrompts().length === 0 ? (
              <Empty description="暂无Prompt" />
            ) : (
              <List
                grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }}
                dataSource={getFilteredPrompts()}
                renderItem={(prompt) => (
                  <List.Item>
                    <Card
                      size="small"
                      hoverable
                      actions={[
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            onClick={() => handleEditPromptRegistry(prompt)}
                            disabled={!prompt.editable}
                          />
                        </Tooltip>,
                        prompt.builtIn && (
                          <Tooltip title="重置">
                            <Button
                              type="text"
                              icon={<RollbackOutlined />}
                              onClick={() => handleResetPromptRegistry(prompt)}
                              disabled={!prompt.editable}
                            />
                          </Tooltip>
                        ),
                        !prompt.builtIn && (
                          <Tooltip title="删除">
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => handleDeletePromptRegistry(prompt)}
                            />
                          </Tooltip>
                        )
                      ].filter(Boolean)}
                    >
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{prompt.name}</span>
                          <Space size="small">
                            <Tag color={getLayerColor(prompt.layer)} style={{ fontSize: 10 }}>
                              {prompt.layer}
                            </Tag>
                            {prompt.builtIn && <Tag color="blue">内置</Tag>}
                            {!prompt.editable && <Tag color="red">只读</Tag>}
                            <Tag color={getCategoryColor(prompt.category)}>
                              {getCategoryLabel(prompt.category)}
                            </Tag>
                          </Space>
                        </div>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                          ID: {prompt.id} | 版本: v{prompt.version}
                        </div>
                        {/* 资源需求标记 */}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                          {prompt.metadata?.requiresMemory && (
                            <Tag color="purple" bordered={false} style={{ fontSize: 10 }}>
                              🧠 记忆
                            </Tag>
                          )}
                          {prompt.metadata?.requiresTools && (
                            <Tag color="green" bordered={false} style={{ fontSize: 10 }}>
                              🔧 工具
                            </Tag>
                          )}
                          {prompt.metadata?.requiresSandbox && (
                            <Tag color="orange" bordered={false} style={{ fontSize: 10 }}>
                              📦 Sandbox
                            </Tag>
                          )}
                        </div>
                      </div>
                      <p style={{ fontSize: 12, color: '#666', margin: 0, marginBottom: 8 }}>
                        {prompt.description}
                      </p>
                      <div style={{ fontSize: 11, color: '#999', maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {prompt.systemPrompt.substring(0, 100)}...
                      </div>
                    </Card>
                  </List.Item>
                )}
              />
            )}
          </div>
        )}
        
        {/* MCP连接器 */}
        {activeTab === 'mcp' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsMCPModalOpen(true)}>
                管理 MCP 连接器
              </Button>
            </div>
            <Card>
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔌</div>
                <h3 style={{ marginBottom: '8px' }}>MCP 连接器管理</h3>
                <p style={{ color: '#666', marginBottom: '24px' }}>MCP (Model Context Protocol) 允许 AI 调用外部工具</p>
                <Button type="primary" size="large" onClick={() => setIsMCPModalOpen(true)}>
                  打开 MCP 管理界面
                </Button>
              </div>
            </Card>
          </div>
        )}
        
        {/* 配置管理 */}
        {activeTab === 'config' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <Card>
              <div style={{ borderBottom: '1px solid #e0e0e0', marginBottom: 20, display: 'flex' }}>
                <button 
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'none',
                    fontSize: 14,
                    fontWeight: 500,
                    color: activeConfigTab === 'kgm-sdk' ? '#1890ff' : '#666666',
                    borderBottom: activeConfigTab === 'kgm-sdk' ? '2px solid #1890ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.3s'
                  }}
                  onClick={() => setActiveConfigTab('kgm-sdk')}
                >
                  Yueli-KGM-Computing SDK
                </button>
                <button 
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'none',
                    fontSize: 14,
                    fontWeight: 500,
                    color: activeConfigTab === 'cloud-inference' ? '#1890ff' : '#666666',
                    borderBottom: activeConfigTab === 'cloud-inference' ? '2px solid #1890ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.3s'
                  }}
                  onClick={() => setActiveConfigTab('cloud-inference')}
                >
                  云端推理
                </button>
                <button 
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'none',
                    fontSize: 14,
                    fontWeight: 500,
                    color: activeConfigTab === 'embedding-config' ? '#1890ff' : '#666666',
                    borderBottom: activeConfigTab === 'embedding-config' ? '2px solid #1890ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.3s'
                  }}
                  onClick={() => setActiveConfigTab('embedding-config')}
                >
                  向量化配置
                </button>
                <button
                  type="button"
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    background: 'none',
                    fontSize: 14,
                    fontWeight: 500,
                    color: activeConfigTab === 'skill-exec-security' ? '#1890ff' : '#666666',
                    borderBottom: activeConfigTab === 'skill-exec-security' ? '2px solid #1890ff' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.3s'
                  }}
                  onClick={() => setActiveConfigTab('skill-exec-security')}
                >
                  服务端脚本
                </button>
              </div>
              
              {activeConfigTab === 'kgm-sdk' && (
                <Form
                  layout="vertical"
                  initialValues={kgmSdkConfig}
                  onFinish={(values) => {
                    localStorage.setItem('kgmBaseUrl', values.baseUrl);
                    localStorage.setItem('kgmApiKey', values.apiKey || '');
                    localStorage.setItem('kgmTimeout', values.timeout.toString());
                    localStorage.setItem('kgmOllamaBaseUrl', values.ollamaBaseUrl || '');
                    localStorage.setItem('kgmScheduleStrategy', values.scheduleStrategy);
                    setKgmSdkConfig(values);
                    toast.success('Yueli-KGM-Computing SDK配置保存成功');
                  }}
                >
                  {/* 调度策略 */}
                  <div style={{ marginBottom: '24px', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f8f9fa', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <label style={{ fontSize: '14px', fontWeight: '600' }}>混合推理调度策略</label>
                      <button
                        onClick={() => {
                          const viteEnv = (import.meta as any).env || {};
                          const kgmBaseUrl = localStorage.getItem('kgmBaseUrl') || viteEnv.VITE_KGM_BASE_URL || '';
                          if (kgmBaseUrl) {
                            window.open(kgmBaseUrl, '_blank');
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          backgroundColor: '#1890ff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span>⚙️</span>
                        <span>KGM Playground</span>
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '24px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="scheduleStrategy"
                          value="kgm-dynamic"
                          checked={kgmSdkConfig.scheduleStrategy === 'kgm-dynamic'}
                          onChange={(e) => {
                            setKgmSdkConfig((prev: any) => ({ ...prev, scheduleStrategy: e.target.value }));
                          }}
                        />
                        <span style={{ fontSize: '14px' }}>KGM (动态路由)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="scheduleStrategy"
                          value="independent"
                          checked={kgmSdkConfig.scheduleStrategy === 'independent'}
                          onChange={(e) => {
                            setKgmSdkConfig((prev: any) => ({ ...prev, scheduleStrategy: e.target.value }));
                          }}
                        />
                        <span style={{ fontSize: '14px' }}>独立调度</span>
                      </label>
                    </div>
                    <p style={{ fontSize: '12px', color: '#666', marginTop: '12px' }}>
                      {kgmSdkConfig.scheduleStrategy === 'kgm-dynamic' 
                        ? 'KGM动态路由：所有LLM配置由KGM统一调度，支持自动路由到Ollama、VMLX或云端推理。' 
                        : '独立调度：每个推理服务独立配置和选择，包括Yueli-KGM-Computing、Ollama、VMLX和云端推理。'}
                    </p>
                  </div>

                  <Form.Item label="后端API地址" name="baseUrl">
                    <Input placeholder="http://127.0.0.1:3000" />
                  </Form.Item>
                  <Form.Item label="API Key (可选)" name="apiKey">
                    <Input placeholder="输入API Key（如需要）" />
                  </Form.Item>
                  <Form.Item label="超时时间 (毫秒)" name="timeout">
                    <InputNumber min={1} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item label="Ollama API地址 (可选)" name="ollamaBaseUrl">
                    <Input placeholder="http://localhost:11434" />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit">
                      保存配置
                    </Button>
                  </Form.Item>
                </Form>
              )}
              
              {activeConfigTab === 'cloud-inference' && (
                <div>
                  <div style={{ marginBottom: '16px' }}>
                    <button
                      type="button"
                      style={{
                        padding: '8px 16px',
                        background: '#1890ff',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                      onClick={() => {
                        setCloudInferenceConfig((prev: any) => ({
                          ...prev,
                          cloudProviders: [...prev.cloudProviders, {
                            id: `provider_${Date.now()}`,
                            name: '新服务商',
                            apiUrl: '',
                            apiKey: '',
                            model: '',
                            enabled: false
                          }]
                        }));
                      }}
                    >
                      添加服务商
                    </button>
                  </div>
                  {cloudInferenceConfig.cloudProviders.map((provider: any, index: number) => (
                    <form key={provider.id} style={{
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      padding: '16px',
                      marginBottom: '12px',
                      background: '#fafafa'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <input
                          type="text"
                          value={provider.name}
                          onChange={(e) => {
                            const updatedProviders = [...cloudInferenceConfig.cloudProviders];
                            updatedProviders[index].name = e.target.value;
                            setCloudInferenceConfig((prev: any) => ({ ...prev, cloudProviders: updatedProviders }));
                          }}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid #d9d9d9',
                            borderRadius: '4px',
                            fontSize: '14px',
                            width: '200px'
                          }}
                          placeholder="服务商名称"
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center' }}>
                            <input
                              type="checkbox"
                              checked={provider.enabled}
                              onChange={(e) => {
                                const updatedProviders = [...cloudInferenceConfig.cloudProviders];
                                updatedProviders[index].enabled = e.target.checked;
                                setCloudInferenceConfig((prev: any) => ({ ...prev, cloudProviders: updatedProviders }));
                              }}
                            />
                            启用
                          </label>
                          <button
                            type="button"
                            style={{
                              padding: '6px 12px',
                              background: '#ff4d4f',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '12px'
                            }}
                            onClick={() => {
                              const updatedProviders = cloudInferenceConfig.cloudProviders.filter((p: any) => p.id !== provider.id);
                              setCloudInferenceConfig((prev: any) => ({ ...prev, cloudProviders: updatedProviders }));
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '14px', display: 'block', marginBottom: '6px' }}>API地址</label>
                        <input
                          type="text"
                          value={provider.apiUrl}
                          onChange={(e) => {
                            const updatedProviders = [...cloudInferenceConfig.cloudProviders];
                            updatedProviders[index].apiUrl = e.target.value;
                            setCloudInferenceConfig((prev: any) => ({ ...prev, cloudProviders: updatedProviders }));
                          }}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid #d9d9d9',
                            borderRadius: '4px',
                            fontSize: '14px',
                            width: '100%'
                          }}
                          placeholder="https://api.example.com/v1/chat/completions"
                        />
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '14px', display: 'block', marginBottom: '6px' }}>API Key</label>
                        <input
                          type="password"
                          value={provider.apiKey}
                          onChange={(e) => {
                            const updatedProviders = [...cloudInferenceConfig.cloudProviders];
                            updatedProviders[index].apiKey = e.target.value;
                            setCloudInferenceConfig((prev: any) => ({ ...prev, cloudProviders: updatedProviders }));
                          }}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid #d9d9d9',
                            borderRadius: '4px',
                            fontSize: '14px',
                            width: '100%'
                          }}
                          placeholder="输入API Key"
                        />
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '14px', display: 'block', marginBottom: '6px' }}>模型版本</label>
                        <input
                          type="text"
                          value={provider.model || ''}
                          onChange={(e) => {
                            const updatedProviders = [...cloudInferenceConfig.cloudProviders];
                            updatedProviders[index].model = e.target.value;
                            setCloudInferenceConfig((prev: any) => ({ ...prev, cloudProviders: updatedProviders }));
                          }}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid #d9d9d9',
                            borderRadius: '4px',
                            fontSize: '14px',
                            width: '100%'
                          }}
                          placeholder="如：gpt-4o-mini"
                        />
                      </div>
                    </form>
                  ))}
                  <Button 
                    type="primary" 
                    onClick={() => {
                      localStorage.setItem('cloudProviders', JSON.stringify(cloudInferenceConfig.cloudProviders));
                      toast.success('云端推理配置保存成功');
                    }}
                  >
                    保存配置
                  </Button>
                </div>
              )}

              {activeConfigTab === 'embedding-config' && (
                <div>
                  <Card title="向量引擎">
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '20px' }}>
                      配置用于语义搜索和文本相似度匹配的向量嵌入服务。支持11种预设快速配置。
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ fontSize: '12px', display: 'block', marginBottom: '8px', fontWeight: '600' }}>快速预设</label>
                      <Select
                        value={embeddingConfig.preset}
                        onChange={(value) => handlePresetChange(value)}
                        style={{ width: '100%' }}
                        placeholder="选择预设自动填充配置"
                      >
                        <Option value="ollama-nomic">Ollama 本地 (nomic-embed-text, 768维)</Option>
                        <Option value="ollama-gemma">Ollama 本地 (embeddinggemma, 768维)</Option>
                        <Option value="openai">OpenAI Cloud (text-embedding-3-small, 1536维)</Option>
                        <Option value="zhipu">智谱 AI (embedding-3, 2048维)</Option>
                        <Option value="gemini">Google Gemini (text-embedding-004, 768维)</Option>
                        <Option value="siliconflow">SiliconFlow (BAAI/bge-m3, 1024维)</Option>
                        <Option value="deepseek">DeepSeek (text-embedding-3, 1536维)</Option>
                        <Option value="cohere">Cohere (embed-V4, 1536维)</Option>
                        <Option value="tongyi">通义千问 (text-embedding-V3, 1536维)</Option>
                        <Option value="together">Together AI (M2-BERT, 768维)</Option>
                      </Select>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                        选择预设自动填充配置，或手动调整下方参数
                      </div>
                    </div>

                    <div>
                      <div 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '8px', 
                          cursor: 'pointer',
                          color: '#1890ff',
                          fontSize: '12px'
                        }}
                        onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
                      >
                        <DownOutlined 
                          style={{ 
                            transform: showAdvancedConfig ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.3s'
                          }} 
                        />
                        高级配置
                      </div>

                      {showAdvancedConfig && (
                        <div style={{ marginTop: '16px', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>服务地址</label>
                            <Input
                              value={embeddingConfig.endpoint}
                              onChange={(e) => setEmbeddingConfig((prev: any) => ({ ...prev, endpoint: e.target.value }))}
                              style={{ width: '100%' }}
                            />
                          </div>

                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>模型</label>
                            <Input
                              value={embeddingConfig.model}
                              onChange={(e) => setEmbeddingConfig((prev: any) => ({ ...prev, model: e.target.value }))}
                              style={{ width: '100%' }}
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                            <div>
                              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>向量维度</label>
                              <InputNumber
                                value={embeddingConfig.dimension}
                                onChange={(value) => setEmbeddingConfig((prev: any) => ({ ...prev, dimension: value }))}
                                style={{ width: '100%' }}
                                min={1}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>批次大小</label>
                              <InputNumber
                                value={embeddingConfig.batchSize}
                                onChange={(value) => setEmbeddingConfig((prev: any) => ({ ...prev, batchSize: value }))}
                                style={{ width: '100%' }}
                                min={1}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>超时(秒)</label>
                              <InputNumber
                                value={embeddingConfig.timeout}
                                onChange={(value) => setEmbeddingConfig((prev: any) => ({ ...prev, timeout: value }))}
                                style={{ width: '100%' }}
                                min={1}
                              />
                            </div>
                          </div>

                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>API Key</label>
                            <Input.Password
                              value={embeddingConfig.apiKey}
                              onChange={(e) => setEmbeddingConfig((prev: any) => ({ ...prev, apiKey: e.target.value }))}
                              style={{ width: '100%' }}
                              placeholder="留空将使用系统默认Key"
                            />
                          </div>

                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>接口格式</label>
                            <Select
                              value={embeddingConfig.format}
                              onChange={(value) => setEmbeddingConfig((prev: any) => ({ ...prev, format: value }))}
                              style={{ width: '100%' }}
                            >
                              <Option value="ollama">Ollama /api/embed</Option>
                              <Option value="openai">OpenAI /v1/embeddings</Option>
                              <Option value="zhipu">智谱 AI</Option>
                              <Option value="gemini">Google Gemini</Option>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: '20px' }}>
                      <Button 
                        type="primary" 
                        onClick={handleSaveEmbeddingConfig}
                      >
                        保存
                      </Button>
                    </div>
                  </Card>
                </div>
              )}

              {activeConfigTab === 'skill-exec-security' && (
                <Card title="服务端脚本执行（高风险）">
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
                    与聊天页 ToolsMenu → Skills 中的开关一致，共用{' '}
                    <code style={{ fontSize: 11 }}>yueli_allow_skill_entry</code> /{' '}
                    <code style={{ fontSize: 11 }}>yueli_allow_skill_runtime</code>。
                    开启后会在对话中暴露 <code style={{ fontSize: 11 }}>skill_entry</code> /{' '}
                    <code style={{ fontSize: 11 }}>skill_runtime</code> 类工具；runtime 还需 Skill Executor 环境变量（如{' '}
                    <code style={{ fontSize: 11 }}>YUELI_ALLOW_SKILL_RUNTIME=1</code>
                    ）。修改后请按底部横幅重载页面以刷新工具列表。
                  </div>
                  <Divider style={{ margin: '12px 0' }} />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '8px 0',
                      borderBottom: '1px solid #f0f0f0'
                    }}
                  >
                    <span style={{ fontSize: 13 }}>允许 manifest.entry 脚本（execute-entry）</span>
                    <Switch
                      checked={allowSkillEntry}
                      onChange={(checked) => {
                        localStorage.setItem('yueli_allow_skill_entry', checked ? '1' : '0');
                        setAllowSkillEntry(checked);
                        markReloadRequired(
                          'toolset_changed',
                          checked
                            ? '已开启 manifest.entry 脚本工具，请重载页面后生效'
                            : '已关闭 manifest.entry 脚本工具，请重载页面后生效'
                        );
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '12px 0 4px'
                    }}
                  >
                    <span style={{ fontSize: 13 }}>允许 runtime.entrypoint（skill_runtime）</span>
                    <Switch
                      checked={allowSkillRuntime}
                      onChange={(checked) => {
                        localStorage.setItem('yueli_allow_skill_runtime', checked ? '1' : '0');
                        setAllowSkillRuntime(checked);
                        markReloadRequired(
                          'toolset_changed',
                          checked
                            ? '已开启 runtime.entrypoint 工具，请重载页面后生效'
                            : '已关闭 runtime.entrypoint 工具，请重载页面后生效'
                        );
                      }}
                    />
                  </div>
                </Card>
              )}
            </Card>
          </div>
        )}

        {/* YueliCopilot 设置 */}
        {activeTab === 'yueli-copilot' && (
          <div style={{ background: '#fff', borderRadius: '8px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <Card title="YueliCopilot 设置">
              <div style={{ marginBottom: '16px', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px', background: '#f8f9fa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#333', marginBottom: '4px' }}>
                      Debug 模式
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      开启后显示调试面板，记录请求和响应信息
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                    <input
                      type="checkbox"
                      checked={yueliDebugEnabled}
                      onChange={(e) => {
                        setYueliDebugEnabled(e.target.checked);
                        debugManager.setEnabled(e.target.checked);
                        toast.success('YueliCopilot配置保存成功');
                      }}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: yueliDebugEnabled ? '#1890ff' : '#ccc',
                      borderRadius: '24px',
                      transition: '0.3s'
                    }}>
                      <span style={{
                        position: 'absolute',
                        content: '',
                        height: '18px',
                        width: '18px',
                        left: yueliDebugEnabled ? '23px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        transition: '0.3s'
                      }} />
                    </span>
                  </label>
                </div>
                <div style={{ fontSize: '11px', color: '#999' }}>
                  调试面板 URL：{window.location.origin}?debug=true
                </div>
              </div>
            </Card>
          </div>
        )}

      {/* 安装插件模态框 */}
      <Modal
        title="安装新插件"
        open={showInstallModal}
        onCancel={() => setShowInstallModal(false)}
        footer={null}
      >
        <Form form={installForm} layout="vertical" onFinish={handleInstallSkill}>
          <Form.Item label="安装方式" name="installMethod" initialValue="url">
            <Select>
              <Option value="url">从 URL 安装</Option>
              <Option value="manual">手动安装</Option>
            </Select>
          </Form.Item>
          
          <Form.Item label="技能 URL" name="skillUrl" dependencies={['installMethod']} rules={[{ required: true, message: '请输入技能仓库 URL' }]}>
            <Input placeholder="输入技能仓库 URL" />
          </Form.Item>
          
          <Form.Item 
            label="技能 ID" 
            name="skillId" 
            dependencies={['installMethod']}
            shouldUpdate={(prevValues: any, currentValues: any) => prevValues.installMethod !== currentValues.installMethod}
          >
            {({ getFieldValue }) => {
              const installMethod = getFieldValue('installMethod');
              if (installMethod === 'manual') {
                return (
                  <Input placeholder="输入技能 ID" />
                );
              }
              return null;
            }}
          </Form.Item>
          
          <Form.Item 
            label="技能名称" 
            name="skillName" 
            dependencies={['installMethod']}
            shouldUpdate={(prevValues: any, currentValues: any) => prevValues.installMethod !== currentValues.installMethod}
          >
            {({ getFieldValue }) => {
              const installMethod = getFieldValue('installMethod');
              if (installMethod === 'manual') {
                return (
                  <Input placeholder="输入技能名称" />
                );
              }
              return null;
            }}
          </Form.Item>
          
          <Form.Item 
            label="技能版本" 
            name="skillVersion" 
            dependencies={['installMethod']}
            shouldUpdate={(prevValues: any, currentValues: any) => prevValues.installMethod !== currentValues.installMethod}
          >
            {({ getFieldValue }) => {
              const installMethod = getFieldValue('installMethod');
              if (installMethod === 'manual') {
                return (
                  <Input placeholder="输入技能版本" />
                );
              }
              return null;
            }}
          </Form.Item>
          
          <Form.Item 
            label="技能作者" 
            name="skillAuthor" 
            dependencies={['installMethod']}
            shouldUpdate={(prevValues: any, currentValues: any) => prevValues.installMethod !== currentValues.installMethod}
          >
            {({ getFieldValue }) => {
              const installMethod = getFieldValue('installMethod');
              if (installMethod === 'manual') {
                return (
                  <Input placeholder="输入技能作者" />
                );
              }
              return null;
            }}
          </Form.Item>
          
          <Form.Item 
            label="技能描述" 
            name="skillDescription" 
            dependencies={['installMethod']}
            shouldUpdate={(prevValues: any, currentValues: any) => prevValues.installMethod !== currentValues.installMethod}
          >
            {({ getFieldValue }) => {
              const installMethod = getFieldValue('installMethod');
              if (installMethod === 'manual') {
                return (
                  <Input.TextArea placeholder="输入技能描述" />
                );
              }
              return null;
            }}
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={installLoading}>
              安装
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setShowInstallModal(false)}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 预检结果模态框 */}
      <Modal
        title={`技能预检：${preflightModalSkill?.name || preflightModalSkill?.id || ''}`}
        open={preflightModalOpen}
        onCancel={() => setPreflightModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setPreflightModalOpen(false)}>
            关闭
          </Button>
        ]}
      >
        {preflightModalSkill && preflightBySkillId[preflightModalSkill.id] ? (
          <div>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
              <Tag color={preflightBySkillId[preflightModalSkill.id].ok ? 'success' : 'error'}>
                {preflightBySkillId[preflightModalSkill.id].ok ? '通过' : '未通过'}
              </Tag>
              <div style={{ fontSize: 12, color: '#666' }}>
                缓存时间：{new Date(preflightBySkillId[preflightModalSkill.id].cachedAt).toLocaleString()}
              </div>
            </div>
            <List
              size="small"
              bordered
              dataSource={preflightBySkillId[preflightModalSkill.id].checks}
              renderItem={(row: any) => (
                <List.Item>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ fontWeight: 600 }}>
                        {row.name}{' '}
                        {row.skipped ? (
                          <Tag color="default">skipped</Tag>
                        ) : (
                          <Tag color={row.ok ? 'success' : 'error'}>{row.ok ? 'ok' : 'fail'}</Tag>
                        )}
                      </div>
                    </div>
                    {row.detail && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{row.detail}</div>}
                  </div>
                </List.Item>
              )}
            />
          </div>
        ) : (
          <Empty description="暂无预检结果" />
        )}
      </Modal>

      {/* 创建任务模态框 */}
      <Modal
        title="创建定时任务"
        open={showCreateTask}
        onCancel={() => setShowCreateTask(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateTask}>
          <Form.Item label="任务名称" name="name">
            <Input placeholder="输入任务名称" />
          </Form.Item>
          
          <Form.Item label="任务描述" name="description">
            <Input.TextArea placeholder="输入任务描述" />
          </Form.Item>
          
          <Form.Item label="插件类型" name="pluginType" initialValue="skill">
            <Select>
              <Option value="skill">技能</Option>
              <Option value="connector">连接器</Option>
            </Select>
          </Form.Item>
          
          <Form.Item label="插件 ID" name="pluginId">
            <Select>
              {plugins.map(plugin => (
                <Option key={plugin.id || plugin.instanceId} value={plugin.id || plugin.instanceId}>
                  {plugin.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          
          <Form.Item label="执行策略" name="strategy" initialValue="INTERVAL">
            <Select>
              <Option value="INTERVAL">定时执行</Option>
              <Option value="DELAY">延迟执行</Option>
            </Select>
          </Form.Item>
          
          <Form.Item label="执行间隔（秒）" name="interval" initialValue={60}>
            <InputNumber min={1} />
          </Form.Item>
          
          <Form.Item label="延迟时间（秒）" name="delay">
            <InputNumber min={0} />
          </Form.Item>
          
          <Form.Item label="重复次数" name="repeatCount">
            <InputNumber min={1} />
          </Form.Item>
          
          <Form.Item label="最大重试次数" name="maxRetries" initialValue={0}>
            <InputNumber min={0} />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit">
              创建
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setShowCreateTask(false)}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 项目主题模态框 */}
      <Modal
        title={editingTopic ? "编辑项目主题" : "添加项目主题"}
        open={showTopicModal}
        onCancel={() => setShowTopicModal(false)}
        footer={null}
      >
        <Form form={topicForm} layout="vertical" onFinish={handleSaveTopic}>
          <Form.Item label="主题名称" name="name" rules={[{ required: true, message: '请输入主题名称' }]}>
            <Input placeholder="输入主题名称" />
          </Form.Item>
          
          <Form.Item label="主题描述" name="description">
            <Input.TextArea placeholder="输入主题描述" />
          </Form.Item>
          
          <Form.Item label="添加文件">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              const fileInput = document.createElement('input');
              fileInput.type = 'file';
              fileInput.multiple = true;
              fileInput.onchange = (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files) {
                  const newFiles = Array.from(target.files).map(file => ({
                    file,
                    addedAt: Date.now()
                  }));
                  setTopicFiles(prev => [...prev, ...newFiles]);
                }
              };
              fileInput.click();
            }}>
              选择文件
            </Button>
          </Form.Item>
          
          {topicFiles.length > 0 && (
            <Form.Item label="已选择文件">
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #e8e8e8', padding: 8, borderRadius: 4 }}>
                {topicFiles.map((item, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span>{item.file.name} ({item.file.size} bytes)</span>
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={() => setTopicFiles(prev => prev.filter((_, i) => i !== index))}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            </Form.Item>
          )}
          
          <Form.Item>
            <Button type="primary" htmlType="submit">
              {editingTopic ? '更新' : '创建'}
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setShowTopicModal(false)}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 快速提示模态框 */}
      <Modal
        title={editingPrompt ? "编辑快速提示" : "添加快速提示"}
        open={showPromptModal}
        onCancel={() => setShowPromptModal(false)}
        footer={null}
      >
        <Form form={promptForm} layout="vertical" onFinish={handleSavePrompt}>
          <Form.Item label="提示 ID" name="id" rules={[{ required: true, message: '请输入提示 ID' }]}>
            <Input placeholder="输入提示 ID（小写字母、数字和连字符）" />
          </Form.Item>
          
          <Form.Item label="提示名称" name="name" rules={[{ required: true, message: '请输入提示名称' }]}>
            <Input placeholder="输入提示名称" />
          </Form.Item>
          
          <Form.Item label="提示内容" name="content" rules={[{ required: true, message: '请输入提示内容' }]}>
            <Input.TextArea placeholder="输入提示内容" />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit">
              {editingPrompt ? '更新' : '创建'}
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setShowPromptModal(false)}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 本地知识库模态框 */}
      <Modal
        title={editingKnowledge ? "编辑本地知识库" : "创建本地知识库"}
        open={showKnowledgeModal}
        onCancel={() => setShowKnowledgeModal(false)}
        footer={null}
      >
        <Form form={knowledgeForm} layout="vertical" onFinish={handleSaveKnowledge}>
          <Form.Item label="知识库名称" name="name" rules={[{ required: true, message: '请输入知识库名称' }]}>
            <Input placeholder="输入知识库名称" />
          </Form.Item>
          
          <Form.Item label="知识库描述" name="description">
            <Input.TextArea placeholder="输入知识库描述" />
          </Form.Item>
          
          <Form.Item label="添加文件/文件夹">
            <Space>
              <Button type="primary" icon={<FileOutlined />} onClick={handleAddKnowledgeFile}>
                选择文件
              </Button>
              <Button type="primary" icon={<FolderOutlined />} onClick={handleAddKnowledgeFolder}>
                选择文件夹
              </Button>
            </Space>
          </Form.Item>
          
          {knowledgeFiles.length > 0 && (
            <Form.Item label="已选择文件/文件夹">
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #e8e8e8', padding: 8, borderRadius: 4 }}>
                {knowledgeFiles.map((file, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {file.type === 'folder' ? <FolderOutlined /> : <FileOutlined />}
                      <span style={{ marginLeft: 8 }}>{file.name} {file.size > 0 && `(${file.size} bytes)`}</span>
                    </div>
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={() => handleRemoveKnowledgeFile(index)}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                已选择 {knowledgeFiles.length} 个文件/文件夹，最多支持 100 个
              </div>
            </Form.Item>
          )}
          
          <Form.Item>
            <Button type="primary" htmlType="submit">
              {editingKnowledge ? '更新' : '创建'}
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setShowKnowledgeModal(false)}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 插件详情模态框 */}
      {showPluginDetail && (
        <Modal
          title="插件详情"
          open={true}
          onCancel={() => setShowPluginDetail(null)}
          footer={null}
          width={600}
        >
          <Descriptions column={1}>
            <Descriptions.Item label="名称">{showPluginDetail.name}</Descriptions.Item>
            <Descriptions.Item label="ID">{showPluginDetail.id || showPluginDetail.instanceId}</Descriptions.Item>
            <Descriptions.Item label="类型">
              {'skill' in showPluginDetail || showPluginDetail.metadata?.type === 'skill' ? '技能' : '连接器'}
            </Descriptions.Item>
            <Descriptions.Item label="版本">{showPluginDetail.version || '1.0.0'}</Descriptions.Item>
            <Descriptions.Item label="状态">{getStatusText(showPluginDetail.status || PluginStatus.DISABLED)}</Descriptions.Item>
            <Descriptions.Item label="描述">{showPluginDetail.description || '暂无描述'}</Descriptions.Item>
            {showPluginDetail.metadata?.capabilities?.length > 0 && (
              <Descriptions.Item label="能力">
                {showPluginDetail.metadata.capabilities.map((cap: string) => (
                  <Tag key={cap} color="blue">{cap}</Tag>
                ))}
              </Descriptions.Item>
            )}
            {showPluginDetail.metadata?.dependencies?.length > 0 && (
              <Descriptions.Item label="依赖">
                {showPluginDetail.metadata.dependencies.map((dep: string) => (
                  <Tag key={dep}>{dep}</Tag>
                ))}
              </Descriptions.Item>
            )}
          </Descriptions>
        </Modal>
      )}

      {/* MCP 管理模态框 */}
      {isMCPModalOpen && <MCPManagerModal onClose={() => setIsMCPModalOpen(false)} />}
      
      {/* Prompt编辑模态框 */}
      <Modal
        title={editingPromptRegistry ? "编辑Prompt" : "新建Prompt"}
        open={showPromptEditModal}
        onCancel={() => setShowPromptEditModal(false)}
        footer={null}
        width={800}
      >
        <Form form={promptEditForm} layout="vertical" onFinish={handleSavePromptRegistry}>
          {!editingPromptRegistry && (
            <Form.Item label="Prompt ID" name="id" rules={[{ required: true, message: '请输入Prompt ID' }]}>
              <Input placeholder="输入唯一的Prompt ID（小写字母、数字和连字符）" />
            </Form.Item>
          )}
          
          {!editingPromptRegistry && (
            <Form.Item label="分类" name="category" initialValue="custom" rules={[{ required: true, message: '请选择分类' }]}>
              <Select placeholder="选择分类">
                <Option value="personality">人格 (Personality)</Option>
                <Option value="skill">技能 (Skill)</Option>
                <Option value="tool">工具 (Tool)</Option>
                <Option value="system">系统 (System)</Option>
                <Option value="custom">自定义 (Custom)</Option>
              </Select>
            </Form.Item>
          )}
          
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="输入Prompt名称" />
          </Form.Item>
          
          <Form.Item label="描述" name="description" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea placeholder="输入Prompt描述" rows={2} />
          </Form.Item>
          
          <Form.Item label="System Prompt" name="systemPrompt" rules={[{ required: true, message: '请输入System Prompt' }]}>
            <Input.TextArea 
              placeholder="输入System Prompt内容" 
              rows={10}
              style={{ fontFamily: 'monospace', fontSize: '13px' }}
            />
          </Form.Item>
          
          <Form.Item label="Function Prompt (可选)" name="functionPrompt">
            <Input.TextArea 
              placeholder="输入Function Prompt内容（可选）" 
              rows={4}
              style={{ fontFamily: 'monospace', fontSize: '13px' }}
            />
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit">
              {editingPromptRegistry ? '更新' : '创建'}
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={() => setShowPromptEditModal(false)}>
              取消
            </Button>
          </Form.Item>
        </Form>
      </Modal>
  </Content>
</Container>
  );
};

export default SkillManager;
