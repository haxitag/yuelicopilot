import React, { useEffect, useState } from 'react';
import { Button, Input, Switch, Typography, message as antMessage } from 'antd';

import { DEFAULT_TOOL_ROUTING_COLLECTION } from '../../services/chat/ToolRoutingRecall';

const { Text, Paragraph } = Typography;

export interface ToolVectorRoutingPanelProps {
  onSyncIndex: () => Promise<{ stored: number; errors: string[] }>;
}

export default function ToolVectorRoutingPanel(props: ToolVectorRoutingPanelProps) {
  const { onSyncIndex } = props;
  const [enabled, setEnabled] = useState(false);
  const [collection, setCollection] = useState(DEFAULT_TOOL_ROUTING_COLLECTION);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem('yueli_tool_routing_vector') === '1');
      setCollection(
        localStorage.getItem('yueli_tool_routing_collection')?.trim() || DEFAULT_TOOL_ROUTING_COLLECTION
      );
    } catch {
      /* ignore */
    }
  }, []);

  const persistCollection = (v: string) => {
    const next = v.trim() || DEFAULT_TOOL_ROUTING_COLLECTION;
    setCollection(next);
    try {
      localStorage.setItem('yueli_tool_routing_collection', next);
    } catch {
      /* ignore */
    }
  };

  const persistEnabled = (v: boolean) => {
    setEnabled(v);
    try {
      if (v) localStorage.setItem('yueli_tool_routing_vector', '1');
      else localStorage.removeItem('yueli_tool_routing_vector');
    } catch {
      /* ignore */
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const r = await onSyncIndex();
      if (r.errors.length) {
        antMessage.warning(`已写入 ${r.stored} 条，部分失败见控制台`);
        console.warn('[ToolRoutingSync]', r.errors);
      } else {
        antMessage.success(`已同步 ${r.stored} 个技能的工具描述到 KGM`);
      }
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ paddingTop: 4 }}>
      <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 10 }}>
        使用 <Text code>kgmMemorySearch</Text> 在指定 collection 内对「技能工具描述」做向量召回，合并进{' '}
        <Text code>selectSkillIdsForTools</Text> 打分。需配置 KGM 与 embedding（与知识库 RAG 相同链路）。
      </Paragraph>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: 12 }}>启用向量工具路由</Text>
        <Switch checked={enabled} onChange={persistEnabled} size="small" />
      </div>
      <div style={{ marginBottom: 10 }}>
        <Text style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Memory collection</Text>
        <Input
          size="small"
          value={collection}
          onChange={(e) => persistCollection(e.target.value)}
          placeholder={DEFAULT_TOOL_ROUTING_COLLECTION}
        />
      </div>
      <Button type="primary" block size="small" loading={syncing} onClick={() => void runSync()}>
        同步当前启用技能的工具索引到 KGM
      </Button>
    </div>
  );
}
