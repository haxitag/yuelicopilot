import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import toast from 'react-hot-toast';
import apiService from '../api/services/apiService';
import { debugManager } from '../services/DebugManager';

const BAR_HEIGHT = 36;
const VISIBILITY_KEY = 'yueli_desktop_dev_bar';

/** 默认隐藏；仅当用户通过菜单「显示调试工具栏」或曾点「隐藏」前设为 visible 时展示 */
export function isDesktopDevBarVisible(): boolean {
  try {
    return localStorage.getItem(VISIBILITY_KEY) === 'visible';
  } catch {
    return false;
  }
}

export function setDesktopDevBarVisible(visible: boolean): void {
  localStorage.setItem(VISIBILITY_KEY, visible ? 'visible' : 'hidden');
}

const Bar = styled.div`
  flex: 0 0 ${BAR_HEIGHT}px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 12px;
  border-bottom: 1px solid #334155;
  box-sizing: border-box;
`;

const UrlInput = styled.input`
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid #475569;
  border-radius: 4px;
  background: #0f172a;
  color: #f1f5f9;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;

  &:focus {
    outline: none;
    border-color: #38bdf8;
  }
`;

const Btn = styled.button`
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid #475569;
  border-radius: 4px;
  background: #334155;
  color: #f1f5f9;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: #475569;
  }
`;

const Hint = styled.span`
  flex: 0 0 auto;
  opacity: 0.75;
  font-size: 11px;
  white-space: nowrap;
`;

function buildUrlWithDebug(on: boolean): string {
  const u = new URL(window.location.href);
  if (on) u.searchParams.set('debug', 'true');
  else u.searchParams.delete('debug');
  return u.toString();
}

const DesktopDevBar: React.FC<{ onHide: () => void }> = ({ onHide }) => {
  const [urlDraft, setUrlDraft] = useState(() => window.location.href);
  const debugOn = debugManager.isEnabledFlag();

  useEffect(() => {
    setUrlDraft(window.location.href);
  }, []);

  const navigate = useCallback((href: string) => {
    try {
      const next = new URL(href, window.location.origin);
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(next.origin)) {
        toast.error('仅允许 localhost / 127.0.0.1');
        return;
      }
      window.location.assign(next.toString());
    } catch {
      toast.error('URL 无效');
    }
  }, []);

  const openDevTools = useCallback(async () => {
    const bridge = window.yueliDesktop;
    if (bridge?.openDevTools) {
      await bridge.openDevTools();
      return;
    }
    toast('请用菜单：视图 → 开发者工具（⌥⌘I）');
  }, []);

  return (
    <Bar title="Mac 桌面端调试栏（无系统地址栏时使用）">
      <Hint>调试</Hint>
      <UrlInput
        value={urlDraft}
        onChange={(e) => setUrlDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate(urlDraft);
        }}
        spellCheck={false}
      />
      <Btn type="button" onClick={() => navigate(urlDraft)}>
        前往
      </Btn>
      <Btn type="button" onClick={() => window.location.reload()}>
        刷新
      </Btn>
      <Btn
        type="button"
        onClick={() => {
          debugManager.setEnabled(!debugOn);
          window.history.replaceState(null, '', buildUrlWithDebug(!debugOn));
        }}
        title="开启时等价于在地址后加 ?debug=true；关闭时同步关闭 Debug 模式"
      >
        {debugOn ? '关请求日志' : '开请求日志'}
      </Btn>
      <Btn type="button" onClick={() => void openDevTools()}>
        开发者工具
      </Btn>
      <Btn
        type="button"
        onClick={() => {
          const r = apiService.clearKgmCanaryCache();
          toast.success(r.message, { duration: 5000 });
        }}
      >
        清预检缓存
      </Btn>
      <Btn
        type="button"
        onClick={onHide}
        title="可在菜单「调试 → 显示调试工具栏」再次打开"
      >
        隐藏
      </Btn>
    </Bar>
  );
};

export default DesktopDevBar;
