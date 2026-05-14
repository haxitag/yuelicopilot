import React from 'react';
import { Alert, Button, Space } from 'antd';
import { useSystemState } from '../../contexts/SystemStateContext';

export default function ReloadRequiredBanner() {
  const { reloadRequired, clearReloadRequired } = useSystemState();

  if (!reloadRequired.pending) return null;

  const latest = reloadRequired.reasons[reloadRequired.reasons.length - 1];
  const count = reloadRequired.reasons.length;

  return (
    <div style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 2000 }}>
      <Alert
        type="warning"
        showIcon
        message="需要重载以生效"
        description={
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div style={{ color: '#666', fontSize: 13, lineHeight: 1.4 }}>
              {count > 1 ? `已累积 ${count} 项变更。` : '检测到配置变更。'}
              {latest?.reason ? ` 最近一次：${latest.reason}` : ''}
            </div>
            <Space>
              <Button
                onClick={() => {
                  clearReloadRequired();
                  window.location.reload();
                }}
                type="primary"
              >
                立即重载
              </Button>
              <Button onClick={clearReloadRequired}>稍后</Button>
            </Space>
          </div>
        }
      />
    </div>
  );
}

