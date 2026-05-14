import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, Spin, Switch, Typography, message as antMessage } from 'antd';

import { fetchToolsets, toggleToolset, type ToolsetRow } from '../../services/toolsetExecutorClient';
import { isToolsetWhitelistFilterEnabled } from '../../services/chat/ToolsetToolFilter';

const { Text, Paragraph } = Typography;

export default function ToolsetPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ToolsetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [whitelistOn, setWhitelistOn] = useState(false);

  useEffect(() => {
    try {
      setWhitelistOn(isToolsetWhitelistFilterEnabled());
    } catch {
      setWhitelistOn(false);
    }
  }, []);

  const persistWhitelist = (v: boolean) => {
    setWhitelistOn(v);
    try {
      if (v) localStorage.setItem('yueli_toolset_filter_enabled', '1');
      else localStorage.removeItem('yueli_toolset_filter_enabled');
    } catch {
      /* ignore */
    }
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchToolsets();
      setRows(data);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleToggle = async (row: ToolsetRow) => {
    try {
      await toggleToolset(row.id);
      antMessage.success(`已切换：${row.name || row.id}`);
      await reload();
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ paddingTop: 4 }}>
      <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>
        数据来自 Skill Executor <Text code>/v1/toolset/list</Text>。下方开关启用后，会将「已启用 toolset 的 tools 列表」与{' '}
        <Text code>skill__*__&lt;name&gt;</Text> / <Text code>mcp__*__&lt;name&gt;</Text> /{' '}
        <Text code>connector__*__&lt;name&gt;</Text> 的尾段 <Text code>&lt;name&gt;</Text> 求交，用于候选技能与最终 tools 列表（与{' '}
        <Text code>ChatContext</Text> 对齐）。
      </Paragraph>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          padding: '6px 0',
          borderBottom: '1px solid #f0f0f0'
        }}
      >
        <Text style={{ fontSize: 12 }}>按 Toolset 白名单过滤 LLM 工具</Text>
        <Switch checked={whitelistOn} onChange={persistWhitelist} size="small" />
      </div>
      <div style={{ marginBottom: 8 }}>
        <Button size="small" onClick={() => void reload()} disabled={loading}>
          刷新
        </Button>
      </div>
      {error && (
        <Text type="danger" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          {error}
        </Text>
      )}
      <Spin spinning={loading}>
        {rows.length === 0 && !loading ? (
          <Empty description="无工具集" />
        ) : (
          <List
            size="small"
            dataSource={rows}
            renderItem={(row) => (
              <List.Item
                actions={[
                  <Switch
                    key="en"
                    size="small"
                    checked={row.enabled !== false}
                    onChange={() => void handleToggle(row)}
                  />
                ]}
              >
                <List.Item.Meta
                  title={<span style={{ fontSize: 13 }}>{row.name}</span>}
                  description={
                    <span style={{ fontSize: 11, color: '#888' }}>
                      {row.id}
                      {Array.isArray(row.tools) && row.tools.length ? ` · tools: ${row.tools.join(', ')}` : ''}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Spin>
    </div>
  );
}
