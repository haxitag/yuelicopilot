import React, { useEffect, useMemo, useState } from 'react';
import { Tabs, Input, Checkbox, Empty, Divider, Select, Button, Switch, Typography, Segmented } from 'antd';

import type { ChatProvider, ModelOption } from '../../services/chat/ModelOptions';
import type { KnowledgeScopeMode } from '../../services/chat/KnowledgeScope';
import SkillsHubPanel from './SkillsHubPanel';
import ToolsetPanel from './ToolsetPanel';
import ToolVectorRoutingPanel from './ToolVectorRoutingPanel';

export interface ToolsMenuSkill {
  id: string;
  name?: string;
  description?: string;
}

export interface ToolsMenuProps {
  skills: ToolsMenuSkill[];
  activeSkillIds: string[];
  onToggleSkill: (skillId: string) => void;

  modelOptions: ModelOption[];
  selectedProvider: ChatProvider;
  selectedModel: string;
  onChangeProviderModel: (provider: ChatProvider, model: string) => void;

  onUploadFiles: () => void;

  /**
   * 与既有上下文构建链路对齐（不在此 Popover 内重复实现 RAG/buildMessages）：
   * 仅提供跳转入口；具体召回仍走 ChatContext + buildMessages。
   */
  knowledgeItemCount?: number;
  selectedPromptsCount?: number;
  lastToolRoundSkillIds?: string[];
  onOpenKnowledgeSelection?: () => void;
  onOpenPromptTemplates?: () => void;

  defaultTabKey?: 'attachments' | 'skills' | 'model' | 'hub' | 'toolsets' | 'routing';

  /** manifest.entry 受控脚本（服务端 execute-entry） */
  allowSkillEntry?: boolean;
  onAllowSkillEntryChange?: (enabled: boolean) => void;
  /** runtime.entrypoint（服务端预执行；需 Skill Executor 环境变量允许） */
  allowSkillRuntime?: boolean;
  onAllowSkillRuntimeChange?: (enabled: boolean) => void;

  /**
   * OpenAI 兼容流式请求是否附带 `stream_options.include_usage`（气泡 token 指标）。
   * 与 `localStorage.yueli_stream_include_usage` 同步，由父组件维护。
   */
  streamIncludeUsage?: boolean;
  onStreamIncludeUsageChange?: (enabled: boolean) => void;
  /** 已设置 `0`/`1` 时展示，用于清除覆盖并回到构建默认（如 VITE_STREAM_INCLUDE_USAGE） */
  streamIncludeUsageHasLocalOverride?: boolean;
  onResetStreamIncludeUsageDefault?: () => void;

  /** 知识库注入策略：全量 / 仅向量片段 / 关闭（localStorage.yueli_knowledge_scope） */
  knowledgeScope?: KnowledgeScopeMode;
  onKnowledgeScopeChange?: (mode: KnowledgeScopeMode) => void;

  /** Skills Hub：经 Executor 代理安装（与 ChatContext.installSkillFromUrl 一致） */
  installSkillFromUrl?: (url: string) => Promise<{ success: boolean; error?: string }>;
  onHubSkillInstalled?: () => void | Promise<void>;
  /** 将当前勾选技能的 OpenAI tool 描述写入 KGM memory，供向量路由召回 */
  onSyncToolRoutingIndex?: () => Promise<{ stored: number; errors: string[] }>;
}

export default function ToolsMenu(props: ToolsMenuProps) {
  const {
    skills,
    activeSkillIds,
    onToggleSkill,
    modelOptions,
    selectedProvider,
    selectedModel,
    onChangeProviderModel,
    onUploadFiles,
    defaultTabKey = 'attachments',
    allowSkillEntry = false,
    onAllowSkillEntryChange,
    allowSkillRuntime = false,
    onAllowSkillRuntimeChange,
    streamIncludeUsage,
    onStreamIncludeUsageChange,
    streamIncludeUsageHasLocalOverride,
    onResetStreamIncludeUsageDefault,
    knowledgeScope,
    onKnowledgeScopeChange,
    knowledgeItemCount = 0,
    selectedPromptsCount = 0,
    lastToolRoundSkillIds = [],
    onOpenKnowledgeSelection,
    onOpenPromptTemplates,
    installSkillFromUrl,
    onHubSkillInstalled,
    onSyncToolRoutingIndex
  } = props;

  const [activeTab, setActiveTab] = useState<string>(defaultTabKey);
  const [skillQuery, setSkillQuery] = useState('');

  useEffect(() => {
    setActiveTab(defaultTabKey);
  }, [defaultTabKey]);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => {
      const name = (s.name || '').toLowerCase();
      const desc = (s.description || '').toLowerCase();
      return name.includes(q) || desc.includes(q) || s.id.toLowerCase().includes(q);
    });
  }, [skills, skillQuery]);

  const modelValue = `${selectedProvider}:${selectedModel}`;

  return (
    <div style={{ width: 400 }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'attachments',
            label: '附件',
            children: (
              <div style={{ paddingTop: 8 }}>
                <Button onClick={onUploadFiles} block>
                  上传图片和文件
                </Button>
                <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
                  支持粘贴图片；文件会作为本轮对话附件发送。
                </div>

                <Divider style={{ margin: '14px 0 10px' }} />
                <Typography.Text strong style={{ fontSize: 12 }}>
                  上下文与检索（沿用现有管线）
                </Typography.Text>
                <Typography.Paragraph type="secondary" style={{ fontSize: 11, margin: '6px 0 10px' }}>
                  知识库与向量召回由 ChatContext（如 <code>kgmMemorySearch</code>）与输入区{' '}
                  <code>buildMessages</code> 注入；快捷提示（含 L5）仍在既有提示流程中合并。
                </Typography.Paragraph>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#555' }}>
                    知识库条目：<Typography.Text strong>{knowledgeItemCount}</Typography.Text>
                    {' · '}
                    已选快捷提示：<Typography.Text strong>{selectedPromptsCount}</Typography.Text>
                  </div>
                  {lastToolRoundSkillIds.length > 0 && (
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.5 }}>
                      本轮 Top-K 工具技能：<Typography.Text code>{lastToolRoundSkillIds.join(', ')}</Typography.Text>
                    </div>
                  )}
                  {(onOpenKnowledgeSelection || onOpenPromptTemplates) && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {onOpenKnowledgeSelection && (
                        <Button size="small" onClick={onOpenKnowledgeSelection}>
                          管理知识库 / RAG 范围
                        </Button>
                      )}
                      {onOpenPromptTemplates && (
                        <Button size="small" onClick={onOpenPromptTemplates}>
                          快捷提示 / 模板
                        </Button>
                      )}
                    </div>
                  )}
                  {knowledgeScope && onKnowledgeScopeChange && (
                    <>
                      <Divider style={{ margin: '14px 0 10px' }} />
                      <Typography.Text strong style={{ fontSize: 12 }}>
                        知识库注入策略
                      </Typography.Text>
                      <Typography.Paragraph type="secondary" style={{ fontSize: 11, margin: '6px 0 10px' }}>
                        「向量」依赖已索引的 KGM memory；无结果时自动回退全量条目。「关闭」则不向模型注入知识库正文。
                      </Typography.Paragraph>
                      <Segmented
                        size="small"
                        value={knowledgeScope}
                        onChange={(v) => onKnowledgeScopeChange(v as KnowledgeScopeMode)}
                        options={[
                          { label: '全量', value: 'full' },
                          { label: '向量', value: 'vector' },
                          { label: '关闭', value: 'off' }
                        ]}
                        block
                      />
                    </>
                  )}
                </div>
              </div>
            )
          },
          {
            key: 'skills',
            label: `Skills（${activeSkillIds.length}）`,
            children: (
              <div style={{ paddingTop: 8 }}>
                <Input
                  value={skillQuery}
                  onChange={(e) => setSkillQuery(e.target.value)}
                  placeholder="搜索技能（名称/描述/ID）"
                  allowClear
                />
                {(onAllowSkillEntryChange || onAllowSkillRuntimeChange) && (
                  <>
                    <Divider style={{ margin: '12px 0' }} />
                    <Typography.Text strong style={{ fontSize: 12 }}>
                      服务端脚本执行（高风险）
                    </Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ fontSize: 11, margin: '6px 0 10px' }}>
                      开启后会在对话工具中暴露 <code>skill_entry</code> / <code>skill_runtime</code>；
                      需在 Skill Executor 上配置对应允许策略（如 <code>YUELI_ALLOW_SKILL_RUNTIME=1</code>）。
                      修改后请按底部提示重载页面以刷新工具列表。
                    </Typography.Paragraph>
                    {onAllowSkillEntryChange && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '6px 0',
                          borderBottom: '1px solid #f5f5f5'
                        }}
                      >
                        <span style={{ fontSize: 12, color: '#333' }}>允许 manifest.entry 脚本</span>
                        <Switch
                          checked={allowSkillEntry}
                          onChange={onAllowSkillEntryChange}
                          size="small"
                        />
                      </div>
                    )}
                    {onAllowSkillRuntimeChange && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '8px 0 4px'
                        }}
                      >
                        <span style={{ fontSize: 12, color: '#333' }}>允许 runtime.entrypoint</span>
                        <Switch
                          checked={allowSkillRuntime}
                          onChange={onAllowSkillRuntimeChange}
                          size="small"
                        />
                      </div>
                    )}
                  </>
                )}
                <Divider style={{ margin: '12px 0' }} />
                {filteredSkills.length === 0 ? (
                  <Empty description="未找到技能" />
                ) : (
                  <div style={{ maxHeight: 320, overflow: 'auto', paddingRight: 4 }}>
                    {filteredSkills.map((skill) => {
                      const enabled = activeSkillIds.includes(skill.id);
                      return (
                        <div
                          key={skill.id}
                          style={{
                            display: 'flex',
                            gap: 10,
                            padding: '8px 4px',
                            borderBottom: '1px solid #f0f0f0'
                          }}
                        >
                          <Checkbox checked={enabled} onChange={() => onToggleSkill(skill.id)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>
                              {skill.name || skill.id}
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                              {skill.description || '（无描述）'}
                            </div>
                            <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                              {skill.id}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )
          },
          {
            key: 'hub',
            label: 'Hub',
            children: installSkillFromUrl ? (
              <SkillsHubPanel installSkillFromUrl={installSkillFromUrl} onInstalled={onHubSkillInstalled} />
            ) : (
              <Empty description="未提供 installSkillFromUrl" />
            )
          },
          {
            key: 'toolsets',
            label: 'Toolset',
            children: <ToolsetPanel />
          },
          {
            key: 'routing',
            label: '向量路由',
            children: onSyncToolRoutingIndex ? (
              <ToolVectorRoutingPanel onSyncIndex={onSyncToolRoutingIndex} />
            ) : (
              <Empty description="未提供 onSyncToolRoutingIndex" />
            )
          },
          {
            key: 'model',
            label: '模型',
            children: (
              <div style={{ paddingTop: 8 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                  选择 Provider/Model（会影响本轮与后续对话的推理服务）。
                </div>
                <Select
                  value={modelValue}
                  style={{ width: '100%' }}
                  options={modelOptions.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(value) => {
                    const [p, ...rest] = String(value).split(':');
                    const m = rest.join(':');
                    onChangeProviderModel(p as ChatProvider, m);
                  }}
                />
                {typeof streamIncludeUsage === 'boolean' && onStreamIncludeUsageChange && (
                  <>
                    <Divider style={{ margin: '14px 0 10px' }} />
                    <Typography.Text strong style={{ fontSize: 12 }}>
                      流式 token 统计
                    </Typography.Text>
                    <Typography.Paragraph type="secondary" style={{ fontSize: 11, margin: '6px 0 10px' }}>
                      开启后在 KGM/OpenAI 兼容请求中附加{' '}
                      <Typography.Text code>stream_options.include_usage</Typography.Text>
                      ，便于消息「本轮指标」展示 tokens（需网关支持）。关闭可避免严格网关拒绝未知字段。
                    </Typography.Paragraph>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '4px 0'
                      }}
                    >
                      <span style={{ fontSize: 12, color: '#333' }}>附带 usage</span>
                      <Switch
                        checked={streamIncludeUsage}
                        onChange={onStreamIncludeUsageChange}
                        size="small"
                      />
                    </div>
                    {streamIncludeUsageHasLocalOverride && onResetStreamIncludeUsageDefault && (
                      <Button type="link" size="small" style={{ paddingLeft: 0, marginTop: 4 }} onClick={onResetStreamIncludeUsageDefault}>
                        恢复默认（清除本地覆盖）
                      </Button>
                    )}
                  </>
                )}
              </div>
            )
          }
        ]}
      />
    </div>
  );
}

