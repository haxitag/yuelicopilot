import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ReloadTrigger =
  | 'skill_installed'
  | 'skill_enabled'
  | 'skill_disabled'
  | 'mcp_changed'
  | 'toolset_changed'
  | 'unknown';

export interface ReloadRequiredState {
  pending: boolean;
  reasons: Array<{ trigger: ReloadTrigger; reason: string; at: number }>;
}

interface SystemStateContextType {
  reloadRequired: ReloadRequiredState;
  markReloadRequired: (trigger: ReloadTrigger, reason: string) => void;
  clearReloadRequired: () => void;
}

const SystemStateContext = createContext<SystemStateContextType | undefined>(undefined);

export function useSystemState() {
  const ctx = useContext(SystemStateContext);
  if (!ctx) throw new Error('useSystemState must be used within SystemStateProvider');
  return ctx;
}

export const SystemStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reasons, setReasons] = useState<ReloadRequiredState['reasons']>([]);

  const markReloadRequired = useCallback((trigger: ReloadTrigger, reason: string) => {
    const entry = { trigger, reason, at: Date.now() };
    setReasons((prev) => [...prev, entry]);
  }, []);

  const clearReloadRequired = useCallback(() => setReasons([]), []);

  const value = useMemo<SystemStateContextType>(() => {
    return {
      reloadRequired: { pending: reasons.length > 0, reasons },
      markReloadRequired,
      clearReloadRequired
    };
  }, [reasons, markReloadRequired, clearReloadRequired]);

  return <SystemStateContext.Provider value={value}>{children}</SystemStateContext.Provider>;
};

