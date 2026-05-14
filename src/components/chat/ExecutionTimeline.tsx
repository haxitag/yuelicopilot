import React, { useMemo } from 'react';
import { Collapse, Timeline } from 'antd';
import type { ExecutionTimelineItem } from '../../types';

function labelForStage(stage: string): string {
  switch (stage) {
    case 'analyze':
      return '分析';
    case 'prepare':
      return '准备';
    case 'execute':
      return '执行';
    case 'transform':
      return '转换';
    case 'complete':
      return '完成';
    case 'error':
      return '错误';
    default:
      return stage;
  }
}

export default function ExecutionTimelineView(props: { items: ExecutionTimelineItem[] }) {
  const items = props.items || [];
  const timelineItems = useMemo(() => {
    return items.map((it) => {
      const title = `${labelForStage(it.stage)}${typeof it.durationMs === 'number' ? ` · ${Math.round(it.durationMs)}ms` : ''}`;
      const desc = it.message ? ` ${it.message}` : '';
      const color = it.stage === 'error' ? 'red' : it.stage === 'complete' ? 'green' : 'blue';
      return {
        color,
        children: (
          <div style={{ fontSize: 12, color: '#666' }}>
            <span style={{ fontWeight: 600, color: '#333' }}>{title}</span>
            {desc}
          </div>
        )
      };
    });
  }, [items]);

  if (!items.length) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <Collapse
        size="small"
        items={[
          {
            key: 'timeline',
            label: `执行计划（${items.length}）`,
            children: <Timeline items={timelineItems as any} />
          }
        ]}
      />
    </div>
  );
}

