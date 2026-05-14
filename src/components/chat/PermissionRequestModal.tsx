import React, { useMemo } from 'react';
import { Modal, Typography, Tag, Space, List, Button } from 'antd';
import type { SkillPermission } from '../../types';
import type { SkillExecutor } from '../../services/SkillExecutor';

const { Text } = Typography;

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny';

export interface PermissionRequestModalProps {
  open: boolean;
  skillId: string;
  permissions: SkillPermission[];
  skillExecutor: SkillExecutor;
  onDecision: (decision: PermissionDecision) => void;
  onCancel: () => void;
}

function riskColor(level: string): string {
  switch (level) {
    case 'low':
      return 'green';
    case 'medium':
      return 'blue';
    case 'high':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'default';
  }
}

export default function PermissionRequestModal(props: PermissionRequestModalProps) {
  const { open, skillId, permissions, skillExecutor, onDecision, onCancel } = props;

  const items = useMemo(() => {
    const unique = Array.from(new Set(permissions));
    return unique.map((p) => {
      const level = skillExecutor.getPermissionRiskLevel(p);
      return {
        permission: p,
        description: skillExecutor.getPermissionDescription(p),
        risk: level
      };
    });
  }, [permissions, skillExecutor]);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="权限请求"
      footer={[
        <Button key="deny" danger onClick={() => onDecision('deny')}>
          拒绝
        </Button>,
        <Button key="once" onClick={() => onDecision('allow_once')}>
          允许一次
        </Button>,
        <Button key="always" type="primary" onClick={() => onDecision('allow_always')}>
          总是允许
        </Button>
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Text>
          技能 <Text code>{skillId}</Text> 请求以下权限以继续执行工具调用：
        </Text>

        <List
          bordered
          dataSource={items}
          renderItem={(it) => (
            <List.Item>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space wrap>
                  <Text code>{it.permission}</Text>
                  <Tag color={riskColor(it.risk)}>{it.risk}</Tag>
                </Space>
                <Text type="secondary">{it.description}</Text>
              </Space>
            </List.Item>
          )}
        />

        <Text type="secondary" style={{ fontSize: 12 }}>
          “允许一次”仅对当前工具调用生效；“总是允许”会写入本地权限策略。
        </Text>
      </Space>
    </Modal>
  );
}

