import React from 'react';
import { Modal, Typography, Button, Space } from 'antd';
import type { ScriptConsentDecision } from '../../services/chat/skillScriptConsent';

const { Text, Paragraph } = Typography;

export type { ScriptConsentDecision };

export interface SkillScriptConsentModalProps {
  open: boolean;
  skillId: string;
  /** runtime → skill_runtime；entry → skill_entry */
  kind: 'runtime' | 'entry';
  onDecision: (decision: ScriptConsentDecision) => void;
  onCancel: () => void;
}

export default function SkillScriptConsentModal(props: SkillScriptConsentModalProps) {
  const { open, skillId, kind, onDecision, onCancel } = props;

  const title =
    kind === 'runtime'
      ? '确认执行 runtime.entrypoint（服务端脚本）'
      : '确认执行 manifest.entry（服务端脚本）';

  const detail =
    kind === 'runtime'
      ? '将在 Skill Executor 上按技能的 runtime.entrypoint 运行脚本；请确认来源可信，且服务端已按需开启 YUELI_ALLOW_SKILL_RUNTIME 等策略。'
      : '将调用服务端 execute-entry 执行 manifest.entry 指向的脚本；请确认来源可信。';

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={title}
      footer={[
        <Button key="deny" danger onClick={() => onDecision('deny')}>
          拒绝
        </Button>,
        <Button key="once" onClick={() => onDecision('allow_once')}>
          允许一次
        </Button>,
        <Button key="always" type="primary" onClick={() => onDecision('allow_always')}>
          总是允许（本技能）
        </Button>
      ]}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text>
          技能 <Text code>{skillId}</Text> 请求执行高风险工具{' '}
          <Text code>{kind === 'runtime' ? 'skill_runtime' : 'skill_entry'}</Text>。
        </Text>
        <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
          {detail}
        </Paragraph>
        <Text type="secondary" style={{ fontSize: 12 }}>
          「允许一次」仅本轮浏览器会话有效；「总是允许」写入本地存储，仅针对该技能 ID。
        </Text>
      </Space>
    </Modal>
  );
}
