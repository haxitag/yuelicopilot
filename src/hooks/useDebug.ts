import { useState, useCallback, useEffect } from 'react';
import type { DebugEntry } from '../components/DebugPanel';

const DEBUG_KEY = 'yueli_debug_enabled';

export const useDebug = () => {
  const [isEnabled, setIsEnabled] = useState(() => {
    const saved = localStorage.getItem(DEBUG_KEY);
    return saved === 'true';
  });
  
  const [entries, setEntries] = useState<DebugEntry[]>([]);

  useEffect(() => {
    localStorage.setItem(DEBUG_KEY, String(isEnabled));
  }, [isEnabled]);

  const addEntry = useCallback((entry: Omit<DebugEntry, 'id' | 'timestamp'>) => {
    if (!isEnabled) return;
    
    const newEntry: DebugEntry = {
      ...entry,
      id: `${entry.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };
    
    setEntries(prev => [...prev, newEntry]);
  }, [isEnabled]);

  const logRequest = useCallback((title: string, data: any, startTime?: number) => {
    addEntry({
      type: 'request',
      title,
      data,
      duration: startTime ? Date.now() - startTime : undefined
    });
  }, [addEntry]);

  const logResponse = useCallback((title: string, data: any, startTime?: number) => {
    addEntry({
      type: 'response',
      title,
      data,
      duration: startTime ? Date.now() - startTime : undefined
    });
  }, [addEntry]);

  const logTransform = useCallback((title: string, data: any) => {
    addEntry({
      type: 'transform',
      title,
      data
    });
  }, [addEntry]);

  const logError = useCallback((title: string, data: any) => {
    addEntry({
      type: 'error',
      title,
      data
    });
  }, [addEntry]);

  const logInfo = useCallback((title: string, data: any) => {
    addEntry({
      type: 'info',
      title,
      data
    });
  }, [addEntry]);

  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  const toggle = useCallback(() => {
    setIsEnabled(prev => !prev);
  }, []);

  return {
    isEnabled,
    setIsEnabled,
    toggle,
    entries,
    clearEntries,
    logRequest,
    logResponse,
    logTransform,
    logError,
    logInfo
  };
};

export default useDebug;
