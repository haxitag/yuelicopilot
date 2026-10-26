import React from 'react';
import { Typography } from 'antd';

export interface SkillRoundPlanPanelProps {
  activeSkillIds: string[];
  skillNames: Map<string, string>;
  toolsInjectedInSystem: boolean;
  openAiToolsSent: boolean;
  evolutionEnabled: boolean;
}

const SkillRoundPlanPanel: React.FC<SkillRoundPlanPanelProps> = ({
  activeSkillIds,
  skillNames,
  toolsInjectedInSystem,
  openAiToolsSent,
  evolutionEnabled
}) => {
  if (activeSkillIds.length === 0) return null;
  return (
    <div
      style={{
        fontSize: 11,
        color: '#666',
        padding: '6px 10px',
        background: '#f5f5f5',
        borderRadius: 6,
        marginBottom: 8
      }}
    >
      <Typography.Text strong style={{ fontSize: 11 }}>
        本轮技能计划
      </Typography.Text>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {activeSkillIds.map((id) => (
          <li key={id}>{skillNames.get(id) || id}</li>
        ))}
      </ul>
      <div>System 注入技能说明：{toolsInjectedInSystem ? '是' : '否'}</div>
      <div>OpenAI tools 发往模型：{openAiToolsSent ? '是' : '否（首轮走 system 注入）'}</div>
      <div>技能进化/AB：{evolutionEnabled ? '开启' : '已关闭'}</div>
    </div>
  );
};

export default SkillRoundPlanPanel;
