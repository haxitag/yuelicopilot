import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import toast from 'react-hot-toast';
import {
  repairStartupDefaults,
  runStartupSelfCheck,
  waitForKgmRouteReady,
  type StartupSelfCheckResult
} from '../services/StartupSelfCheck';

const Panel = styled.div`
  position: fixed;
  left: 50%;
  right: auto;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 1200;
  width: min(460px, calc(100vw - 36px));
  max-height: min(560px, calc(100vh - 36px));
  overflow: auto;
  border: 1px solid #d9e2ef;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  color: #1f2937;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #eef2f7;
`;

const Title = styled.div`
  font-size: 14px;
  font-weight: 650;
`;

const Body = styled.div`
  padding: 10px 14px 12px;
`;

const Item = styled.div<{ $status: string }>`
  padding: 9px 0;
  border-bottom: 1px solid #f1f5f9;

  &:last-child {
    border-bottom: 0;
  }

  strong {
    color: ${({ $status }) =>
      $status === 'error' ? '#b91c1c' : $status === 'warn' ? '#92400e' : '#166534'};
  }
`;

const Detail = styled.div`
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
  white-space: pre-wrap;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 14px 14px;
`;

const Button = styled.button<{ $primary?: boolean }>`
  height: 30px;
  padding: 0 12px;
  border: 1px solid ${({ $primary }) => ($primary ? '#2563eb' : '#cbd5e1')};
  border-radius: 6px;
  background: ${({ $primary }) => ($primary ? '#2563eb' : '#fff')};
  color: ${({ $primary }) => ($primary ? '#fff' : '#334155')};
  font-size: 12px;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

function shouldShow(result: StartupSelfCheckResult | null): boolean {
  if (!result) return false;
  return result.items.some((item) => item.status === 'error' || item.status === 'warn');
}

const StartupSelfCheckBanner: React.FC = () => {
  const [result, setResult] = useState<StartupSelfCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        let next = await runStartupSelfCheck();
        const kgmDown = next.items.some((i) => i.id === 'kgm' && i.status === 'error');
        if (!next.ok && kgmDown) {
          await waitForKgmRouteReady({ timeoutMs: 25_000 });
          next = await runStartupSelfCheck();
        }
        setResult(next);
      })();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const visible = useMemo(() => !dismissed && shouldShow(result), [dismissed, result]);

  if (!visible || !result) return null;

  const problemCount = result.items.filter((item) => item.status !== 'ok').length;

  return (
    <Panel>
      <Header>
        <Title>启动自检 · {problemCount} 项</Title>
        <Button type="button" onClick={() => setDismissed(true)}>
          稍后
        </Button>
      </Header>
      <Body>
        {result.items
          .filter((item) => item.status !== 'ok')
          .map((item, idx) => (
            <Item key={`${item.id}-${idx}`} $status={item.status}>
              <strong>{item.label}</strong>
              <Detail>{item.detail}</Detail>
              {item.fix && <Detail>{item.fix}</Detail>}
            </Item>
          ))}
      </Body>
      <Actions>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void runStartupSelfCheck()
              .then(setResult)
              .finally(() => setBusy(false));
          }}
        >
          重新检测
        </Button>
        <Button
          type="button"
          $primary
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void repairStartupDefaults()
              .then((next) => {
                setResult(next);
                if (next.ok) {
                  toast.success('自检通过');
                } else {
                  const first = next.items.find((i) => i.status === 'error');
                  toast.error(
                    first
                      ? `${first.label}：${first.detail}`
                      : '后台仍未就绪，请查看 ~/Library/Application Support/Yueli Copilot/runtime/kgm.log',
                    { duration: 6000 }
                  );
                }
              })
              .catch((e) => {
                toast.error(e instanceof Error ? e.message : '一键修复失败');
              })
              .finally(() => setBusy(false));
          }}
        >
          一键修复
        </Button>
      </Actions>
    </Panel>
  );
};

export default StartupSelfCheckBanner;
