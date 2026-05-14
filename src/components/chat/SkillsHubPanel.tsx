import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, List, Spin, Typography, message as antMessage } from 'antd';

import {
  buildSkillshubWtfInstallUrl,
  fetchSkillsHubSearch,
  fetchSkillsHubTrending,
  normalizeSkillshubOwnerSegment,
  type SkillsHubListingDto
} from '../../services/skillsHubExecutorClient';

const { Text, Paragraph } = Typography;

export interface SkillsHubPanelProps {
  installSkillFromUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  onInstalled?: () => void;
}

export default function SkillsHubPanel(props: SkillsHubPanelProps) {
  const { installSkillFromUrl, onInstalled } = props;
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<SkillsHubListingDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadTrending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchSkillsHubTrending(14);
      setList(rows);
      if (rows.length === 0) {
        setError('Hub 返回空列表（请确认 Skill Executor 已启动且可访问外网）');
      }
    } catch (e) {
      setList([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrending();
  }, [loadTrending]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      void loadTrending();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchSkillsHubSearch(q, 30);
      setList(rows);
    } catch (e) {
      setList([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (row: SkillsHubListingDto) => {
    const url = buildSkillshubWtfInstallUrl(row);
    setInstallingId(row.id);
    try {
      const r = await installSkillFromUrl(url);
      if (r.success) {
        antMessage.success(`已请求安装：${row.name || row.id}`);
        onInstalled?.();
      } else {
        antMessage.error(r.error || '安装失败');
      }
    } catch (e) {
      antMessage.error(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div style={{ paddingTop: 4 }}>
      <Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 8 }}>
        列表经 Skill Executor 代理拉取（<Text code>/v1/skills-hub/*</Text>），安装走与聊天相同的{' '}
        <Text code>installSkillFromUrl</Text>（skillshub.wtf 仓库 URL）。
      </Paragraph>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索 Hub 技能…"
          onPressEnter={() => void handleSearch()}
          allowClear
        />
        <Button type="primary" onClick={() => void handleSearch()} loading={loading}>
          搜索
        </Button>
        <Button onClick={() => void loadTrending()} disabled={loading}>
          热门
        </Button>
      </div>
      {error && (
        <Text type="danger" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          {error}
        </Text>
      )}
      <Spin spinning={loading}>
        {list.length === 0 && !loading ? (
          <Empty description="暂无数据" />
        ) : (
          <List
            size="small"
            style={{ maxHeight: 300, overflow: 'auto' }}
            dataSource={list}
            renderItem={(row) => (
              <List.Item
                actions={[
                  <Button
                    key="in"
                    type="link"
                    size="small"
                    loading={installingId === row.id}
                    onClick={() => void handleInstall(row)}
                  >
                    安装
                  </Button>
                ]}
              >
                <List.Item.Meta
                  title={<span style={{ fontSize: 13 }}>{row.name}</span>}
                  description={
                    <span style={{ fontSize: 11, color: '#888' }}>
                      {row.id} · {row.author}
                      {row.installOwner &&
                      row.installOwner !== normalizeSkillshubOwnerSegment(row.author) ? (
                        <> · 安装 owner: {row.installOwner}</>
                      ) : null}
                      {row.description ? ` — ${row.description.slice(0, 120)}` : ''}
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
