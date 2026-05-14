import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { LanguageProvider } from './contexts/LanguageContext';
import { AuthProvider } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { SystemStateProvider } from './contexts/SystemStateContext';
import { useLoading } from './contexts/LoadingContext';
import { AppPageLoadingSplash } from './components/common/AppPageLoadingSplash';
import ReloadRequiredBanner from './components/common/ReloadRequiredBanner';
import YueliCopilot from './components/YueliCopilot';
import SkillManager from './components/SkillManager';
import CheckboxTest from './components/CheckboxTest';
import SkillManagerTest from './components/SkillManagerTest';
import DebugPanel from './components/DebugPanel';
import { debugManager } from './services/DebugManager';
import styled from 'styled-components';

const AppContainer = styled.div`
  width: 100%;
  height: 100vh;
  overflow: hidden;
`;

const AppContent: React.FC = () => {
  const { setLoading, setLoadingMessage } = useLoading();
  const [initialLoad, setInitialLoad] = useState(true);
  const [debugModeEnabled, setDebugModeEnabled] = useState(debugManager.isEnabledFlag());
  const [debugPanelOpen, setDebugPanelOpen] = useState(false); // Debug 窗口默认收起
  const [debugEntries, setDebugEntries] = useState(debugManager.getEntries());

  useEffect(() => {
    // 模拟页面加载
    setLoading(true);
    setLoadingMessage('正在初始化...');
    
    const timer = setTimeout(() => {
      setLoading(false);
      setInitialLoad(false);
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [setLoading, setLoadingMessage]);

  useEffect(() => {
    // 订阅调试日志更新
    const unsubscribe = debugManager.subscribe((entries) => {
      setDebugEntries(entries);
    });
    
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    // 监听 debugManager 状态变化
    const checkDebugMode = () => {
      setDebugModeEnabled(debugManager.isEnabledFlag());
    };
    
    // 每 100ms 检查一次（简单实现）
    const interval = setInterval(checkDebugMode, 100);
    
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // 监听 URL 参数开启 debug 模式
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true') {
      debugManager.setEnabled(true);
      setDebugPanelOpen(true); // 开启模式时同时展开窗口
    }
  }, []);

  const handleToggleDebugPanel = useCallback(() => {
    // 切换 Debug 窗口的展开/收起
    setDebugPanelOpen(prev => !prev);
  }, []);

  if (initialLoad) {
    return null; // 让LoadingProvider处理加载动画
  }

  const copilotPage = (
    <YueliCopilot
      debugModeEnabled={debugModeEnabled}
      onToggleDebugPanel={handleToggleDebugPanel}
    />
  );

  return (
    <AppContainer>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<AppPageLoadingSplash variant="route" />}>
          <Routes>
            <Route path="/" element={copilotPage} />
            <Route path="/chat/:threadId" element={copilotPage} />
            <Route path="/manager" element={<SkillManager />} />
            <Route path="/test-checkbox" element={<CheckboxTest />} />
            <Route path="/test-manager" element={<SkillManagerTest />} />
          </Routes>
        </Suspense>
      </Router>
      <Toaster position="bottom-right" />
      <ReloadRequiredBanner />
      {debugModeEnabled && (
        <DebugPanel 
          isOpen={debugPanelOpen} 
          onClose={handleToggleDebugPanel} 
          entries={debugEntries} 
        />
      )}
    </AppContainer>
  );
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <SystemStateProvider>
          <ChatProvider>
            <AppContent />
          </ChatProvider>
        </SystemStateProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;