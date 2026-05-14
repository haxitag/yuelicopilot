import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { getMCPRuntime, MCPServerConfig, MCPServerStatus } from '../services/mcp/MCPRuntime';
import { toast } from 'react-hot-toast';
import { useSystemState } from '../contexts/SystemStateContext';

// ==================== Styled Components ====================

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Modal = styled.div`
  background: #fff;
  border-radius: 12px;
  width: 860px;
  max-width: 95vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  overflow: hidden;
`;

const ModalHeader = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fafafa;
`;

const ModalTitle = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
`;

const ModalBody = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  gap: 0;
`;

const Sidebar = styled.div`
  width: 220px;
  border-right: 1px solid #e8e8e8;
  padding: 16px 0;
  background: #fafafa;
  flex-shrink: 0;
`;

const SidebarItem = styled.div<{ active?: boolean }>`
  padding: 10px 20px;
  cursor: pointer;
  font-size: 14px;
  color: ${p => p.active ? '#1890ff' : '#333'};
  background: ${p => p.active ? '#e6f4ff' : 'transparent'};
  border-left: 3px solid ${p => p.active ? '#1890ff' : 'transparent'};
  transition: all 0.2s;
  &:hover { background: ${p => p.active ? '#e6f4ff' : '#f0f0f0'}; }
`;

const Content = styled.div`
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
`;

const ServerCard = styled.div`
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  background: #fff;
  transition: box-shadow 0.2s;
  &:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
`;

const ServerHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
`;

const ServerName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
`;

const ServerDesc = styled.div`
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
`;

const StatusBadge = styled.span<{ connected?: boolean; error?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  background: ${p => p.error ? '#fff2f0' : p.connected ? '#f6ffed' : '#f5f5f5'};
  color: ${p => p.error ? '#ff4d4f' : p.connected ? '#52c41a' : '#999'};
  border: 1px solid ${p => p.error ? '#ffccc7' : p.connected ? '#b7eb8f' : '#d9d9d9'};
`;

const Dot = styled.span<{ connected?: boolean; error?: boolean }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${p => p.error ? '#ff4d4f' : p.connected ? '#52c41a' : '#d9d9d9'};
`;

const TagList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
`;

const Tag = styled.span`
  padding: 2px 8px;
  background: #f0f5ff;
  color: #2f54eb;
  border-radius: 4px;
  font-size: 11px;
`;

const BtnRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 10px;
`;

const Btn = styled.button<{ variant?: 'primary' | 'danger' | 'default' }>`
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid ${p =>
    p.variant === 'primary' ? '#1890ff' :
    p.variant === 'danger' ? '#ff4d4f' : '#d9d9d9'};
  background: ${p =>
    p.variant === 'primary' ? '#1890ff' :
    p.variant === 'danger' ? '#fff2f0' : '#fff'};
  color: ${p =>
    p.variant === 'primary' ? '#fff' :
    p.variant === 'danger' ? '#ff4d4f' : '#333'};
  transition: all 0.2s;
  &:hover {
    opacity: 0.85;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #333;
  margin-bottom: 6px;
`;

const Input = styled.input`
  width: 100%;
  padding: 1px 1px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.1); }
`;

const Select = styled.select`
  width: 100%;
  padding: 1px 1px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  &:focus { outline: none; border-color: #1890ff; }
`;

const Textarea = styled.textarea`
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
  resize: vertical;
  min-height: 80px;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #1890ff; }
`;

const Toggle = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #333;
`;

const ToggleInput = styled.input`
  width: 36px;
  height: 20px;
  appearance: none;
  background: #d9d9d9;
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
  &:checked { background: #1890ff; }
  &::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    top: 2px;
    left: 2px;
    transition: left 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  &:checked::after { left: 18px; }
`;

const SectionTitle = styled.h3`
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  margin: 0 0 16px 0;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: #999;
  font-size: 14px;
`;

const ErrorText = styled.div`
  color: #ff4d4f;
  font-size: 12px;
  margin-top: 4px;
  padding: 6px 10px;
  background: #fff2f0;
  border-radius: 4px;
`;

const InfoBox = styled.div`
  background: #e6f4ff;
  border: 1px solid #91caff;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  color: #0958d9;
  margin-bottom: 16px;
`;

// ==================== Types ====================

type Tab = 'servers' | 'add' | 'tools';

interface FormState {
  id: string;
  name: string;
  type: MCPServerConfig['type'];
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  timeout: string;
  enabled: boolean;
  description: string;
}

const defaultForm: FormState = {
  id: '', name: '', type: 'stdio',
  command: '', args: '', env: '{}',
  url: '', headers: '{}',
  timeout: '30000', enabled: true, description: ''
};

// ==================== Component ====================

interface Props {
  onClose: () => void;
}

const MCPManagerModal: React.FC<Props> = ({ onClose }) => {
  const { markReloadRequired } = useSystemState();
  const [tab, setTab] = useState<Tab>('servers');
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [statuses, setStatuses] = useState<Map<string, MCPServerStatus>>(new Map());
  const [form, setForm] = useState<FormState>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState('');

  const runtime = getMCPRuntime();

  const refresh = useCallback(() => {
    setServers(runtime.getAllServers());
    const statusMap = new Map<string, MCPServerStatus>();
    runtime.getAllServerStatuses().forEach(s => statusMap.set(s.id, s));
    setStatuses(statusMap);
  }, [runtime]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleConnect = async (id: string) => {
    setConnecting(prev => new Set(prev).add(id));
    try {
      await runtime.connectServer(id);
      toast.success('连接成功');
      markReloadRequired('mcp_changed', `MCP 连接器已连接: ${id}`);
    } catch (e) {
      toast.error(`连接失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(prev => { const s = new Set(prev); s.delete(id); return s; });
      refresh();
    }
  };

  const handleDisconnect = async (id: string) => {
    await runtime.disconnectServer(id);
    refresh();
    toast.success('已断开连接');
    markReloadRequired('mcp_changed', `MCP 连接器已断开: ${id}`);
  };

  const handleToggleEnabled = (id: string, enabled: boolean) => {
    runtime.updateServer(id, { enabled });
    refresh();
    markReloadRequired('mcp_changed', `MCP 连接器已${enabled ? '启用' : '停用'}: ${id}`);
  };

  const handleDelete = (id: string) => {
    if (!confirm('确认删除此 MCP Server？')) return;
    runtime.removeServer(id);
    refresh();
    toast.success('已删除');
    markReloadRequired('mcp_changed', `MCP 连接器已移除: ${id}`);
  };

  const handleEdit = (server: MCPServerConfig) => {
    setEditingId(server.id);
    setForm({
      id: server.id,
      name: server.name,
      type: server.type,
      command: server.command || '',
      args: (server.args || []).join(' '),
      env: JSON.stringify(server.env || {}, null, 2),
      url: server.url || '',
      headers: JSON.stringify(server.headers || {}, null, 2),
      timeout: String(server.timeout || 30000),
      enabled: server.enabled,
      description: server.description || ''
    });
    setTab('add');
  };

  const handleFormSubmit = () => {
    setFormError('');

    if (!form.id.trim()) { setFormError('Server ID 不能为空'); return; }
    if (!form.name.trim()) { setFormError('名称不能为空'); return; }
    if (form.type === 'stdio' && !form.command.trim()) { setFormError('stdio 类型需要填写命令'); return; }
    if ((form.type === 'http' || form.type === 'sse' || form.type === 'websocket') && !form.url.trim()) {
      setFormError('HTTP/SSE/WebSocket 类型需要填写 URL'); return;
    }

    let env: Record<string, string> = {};
    let headers: Record<string, string> = {};
    try { env = JSON.parse(form.env || '{}'); } catch { setFormError('env 格式错误，请输入有效 JSON'); return; }
    try { headers = JSON.parse(form.headers || '{}'); } catch { setFormError('headers 格式错误，请输入有效 JSON'); return; }

    const config: MCPServerConfig = {
      id: form.id.trim(),
      name: form.name.trim(),
      type: form.type,
      command: form.command.trim() || undefined,
      args: form.args.trim() ? form.args.trim().split(/\s+/) : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      url: form.url.trim() || undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      timeout: parseInt(form.timeout) || 30000,
      enabled: form.enabled,
      description: form.description.trim()
    };

    if (editingId) {
      runtime.updateServer(editingId, config);
      toast.success('已更新');
      markReloadRequired('mcp_changed', `MCP 连接器已更新: ${editingId}`);
    } else {
      if (runtime.getServer(config.id)) { setFormError('Server ID 已存在'); return; }
      runtime.addServer(config);
      toast.success('已添加');
      markReloadRequired('mcp_changed', `MCP 连接器已新增: ${config.id}`);
    }

    setForm(defaultForm);
    setEditingId(null);
    setTab('servers');
    refresh();
  };

  const handleCancelEdit = () => {
    setForm(defaultForm);
    setEditingId(null);
    setTab('servers');
    setFormError('');
  };

  const allTools = runtime.getAllTools();

  return (
    <Overlay onClick={e => e.target === e.currentTarget && onClose()}>
      <Modal>
        <ModalHeader>
          <ModalTitle>🔌 MCP 连接器管理</ModalTitle>
          <Btn onClick={onClose}>✕ 关闭</Btn>
        </ModalHeader>

        <ModalBody>
          <Sidebar>
            <SidebarItem active={tab === 'servers'} onClick={() => setTab('servers')}>
              📡 已配置 Servers ({servers.length})
            </SidebarItem>
            <SidebarItem active={tab === 'add'} onClick={() => { setEditingId(null); setForm(defaultForm); setTab('add'); }}>
              ➕ {editingId ? '编辑 Server' : '添加 Server'}
            </SidebarItem>
            <SidebarItem active={tab === 'tools'} onClick={() => setTab('tools')}>
              🛠 可用工具 ({allTools.length})
            </SidebarItem>
          </Sidebar>

          <Content>
            {/* ===== Servers Tab ===== */}
            {tab === 'servers' && (
              <>
                <SectionTitle>已配置的 MCP Servers</SectionTitle>
                <InfoBox>
                  MCP (Model Context Protocol) 允许 AI 调用外部工具。stdio 类型通过 KGM 后端代理运行，http/websocket 类型直接连接。
                </InfoBox>

                {servers.length === 0 ? (
                  <EmptyState>
                    暂无配置的 MCP Server<br />
                    <Btn variant="primary" style={{ marginTop: 12 }} onClick={() => setTab('add')}>
                      添加第一个 Server
                    </Btn>
                  </EmptyState>
                ) : (
                  servers.map(server => {
                    const status = statuses.get(server.id);
                    const isConnecting = connecting.has(server.id);
                    return (
                      <ServerCard key={server.id}>
                        <ServerHeader>
                          <div>
                            <ServerName>{server.name}</ServerName>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                              ID: {server.id} · {server.type.toUpperCase()}
                              {server.type === 'stdio' && server.command && ` · ${server.command} ${(server.args || []).join(' ')}`}
                              {server.url && ` · ${server.url}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Toggle>
                              <ToggleInput
                                type="checkbox"
                                checked={server.enabled}
                                onChange={e => handleToggleEnabled(server.id, e.target.checked)}
                              />
                              {server.enabled ? '启用' : '禁用'}
                            </Toggle>
                            <StatusBadge connected={status?.connected} error={!!status?.error}>
                              <Dot connected={status?.connected} error={!!status?.error} />
                              {isConnecting ? '连接中...' : status?.connected ? '已连接' : status?.error ? '错误' : '未连接'}
                            </StatusBadge>
                          </div>
                        </ServerHeader>

                        {server.description && <ServerDesc>{server.description}</ServerDesc>}

                        {status?.error && <ErrorText>⚠ {status.error}</ErrorText>}

                        {status?.connected && status.tools.length > 0 && (
                          <TagList>
                            {status.tools.map(t => (
                              <Tag key={t.name} title={t.description}>🔧 {t.name}</Tag>
                            ))}
                          </TagList>
                        )}

                        <BtnRow>
                          {status?.connected ? (
                            <Btn variant="danger" onClick={() => handleDisconnect(server.id)}>断开</Btn>
                          ) : (
                            <Btn
                              variant="primary"
                              disabled={!server.enabled || isConnecting}
                              onClick={() => handleConnect(server.id)}
                            >
                              {isConnecting ? '连接中...' : '连接'}
                            </Btn>
                          )}
                          <Btn onClick={() => handleEdit(server)}>编辑</Btn>
                          <Btn variant="danger" onClick={() => handleDelete(server.id)}>删除</Btn>
                        </BtnRow>
                      </ServerCard>
                    );
                  })
                )}
              </>
            )}

            {/* ===== Add/Edit Tab ===== */}
            {tab === 'add' && (
              <>
                <SectionTitle>{editingId ? '编辑 MCP Server' : '添加 MCP Server'}</SectionTitle>

                <FormGroup>
                  <Label>Server ID *</Label>
                  <Input
                    value={form.id}
                    onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
                    placeholder="唯一标识符，如 filesystem"
                    disabled={!!editingId}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>名称 *</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="显示名称，如 文件系统"
                  />
                </FormGroup>

                <FormGroup>
                  <Label>描述</Label>
                  <Input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="简短描述"
                  />
                </FormGroup>

                <FormGroup>
                  <Label>连接类型 *</Label>
                  <Select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as any }))}
                  >
                    <option value="stdio">stdio (通过 KGM 代理运行本地命令)</option>
                    <option value="http">HTTP (直接 HTTP 请求)</option>
                    <option value="sse">SSE (Server-Sent Events)</option>
                    <option value="websocket">WebSocket</option>
                  </Select>
                </FormGroup>

                {form.type === 'stdio' && (
                  <>
                    <FormGroup>
                      <Label>命令 *</Label>
                      <Input
                        value={form.command}
                        onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                        placeholder="如 npx 或 python"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>参数 (空格分隔)</Label>
                      <Input
                        value={form.args}
                        onChange={e => setForm(f => ({ ...f, args: e.target.value }))}
                        placeholder="如 -y @modelcontextprotocol/server-filesystem /tmp"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>环境变量 (JSON)</Label>
                      <Textarea
                        value={form.env}
                        onChange={e => setForm(f => ({ ...f, env: e.target.value }))}
                        placeholder='{"API_KEY": "your-key"}'
                      />
                    </FormGroup>
                  </>
                )}

                {(form.type === 'http' || form.type === 'sse' || form.type === 'websocket') && (
                  <>
                    <FormGroup>
                      <Label>URL *</Label>
                      <Input
                        value={form.url}
                        onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                        placeholder="如 http://localhost:8080/mcp"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>请求头 (JSON)</Label>
                      <Textarea
                        value={form.headers}
                        onChange={e => setForm(f => ({ ...f, headers: e.target.value }))}
                        placeholder='{"Authorization": "Bearer token"}'
                      />
                    </FormGroup>
                  </>
                )}

                <FormGroup>
                  <Label>超时 (毫秒)</Label>
                  <Input
                    type="number"
                    value={form.timeout}
                    onChange={e => setForm(f => ({ ...f, timeout: e.target.value }))}
                    placeholder="30000"
                  />
                </FormGroup>

                <FormGroup>
                  <Toggle>
                    <ToggleInput
                      type="checkbox"
                      checked={form.enabled}
                      onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                    />
                    启用此 Server
                  </Toggle>
                </FormGroup>

                {formError && <ErrorText>{formError}</ErrorText>}

                <BtnRow>
                  <Btn variant="primary" onClick={handleFormSubmit}>
                    {editingId ? '保存修改' : '添加 Server'}
                  </Btn>
                  <Btn onClick={handleCancelEdit}>取消</Btn>
                </BtnRow>

                <div style={{ marginTop: 24, padding: '12px 16px', background: '#f9f9f9', borderRadius: 8, fontSize: 13, color: '#666' }}>
                  <strong>常用 MCP Servers：</strong><br />
                  • 文件系统: <code>npx -y @modelcontextprotocol/server-filesystem /path</code><br />
                  • Brave 搜索: <code>npx -y @modelcontextprotocol/server-brave-search</code><br />
                  • SQLite: <code>npx -y @modelcontextprotocol/server-sqlite --db-path /tmp/db.sqlite</code><br />
                  • GitHub: <code>npx -y @modelcontextprotocol/server-github</code>
                </div>
              </>
            )}

            {/* ===== Tools Tab ===== */}
            {tab === 'tools' && (
              <>
                <SectionTitle>可用工具 ({allTools.length})</SectionTitle>
                {allTools.length === 0 ? (
                  <EmptyState>
                    暂无可用工具<br />
                    请先连接 MCP Server
                  </EmptyState>
                ) : (
                  allTools.map(tool => (
                    <ServerCard key={`${tool.serverId}:${tool.name}`}>
                      <ServerHeader>
                        <ServerName>🔧 {tool.name}</ServerName>
                        <Tag>{tool.serverId}</Tag>
                      </ServerHeader>
                      <ServerDesc>{tool.description}</ServerDesc>
                      {tool.inputSchema?.properties && (
                        <TagList>
                          {Object.entries(tool.inputSchema.properties).map(([key, schema]: [string, any]) => (
                            <Tag key={key} title={schema.description}>
                              {key}{tool.inputSchema.required?.includes(key) ? ' *' : ''}
                            </Tag>
                          ))}
                        </TagList>
                      )}
                    </ServerCard>
                  ))
                )}
              </>
            )}
          </Content>
        </ModalBody>
      </Modal>
    </Overlay>
  );
};

export default MCPManagerModal;
