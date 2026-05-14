/**
 * Auth Context - 认证上下文
 * 
 * 注意：认证由上游网关层统一处理
 * 此 Context 仅提供基础的认证状态访问接口
 * 不包含任何鉴权逻辑或 mock 实现
 */

import React, { createContext, useContext, useState, useEffect } from 'react';

interface AuthContextType {
  /** 认证初始化状态 */
  isInitialized: boolean;
  /** 获取当前用户信息（由网关层注入） */
  user: any;
  /** 刷新上下文（网关层认证变化时调用） */
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * 认证 Provider
 * 
 * 认证逻辑完全由上游网关层处理：
 * - 网关层负责用户身份验证
 * - 网关层负责 token 管理
 * - 网关层负责权限控制
 * 
 * 此组件仅监听网关层的认证状态变化
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // 监听网关层认证变化事件
    const handleAuthChange = (event: CustomEvent) => {
      if (event.detail?.user) {
        setUser(event.detail.user);
      }
      setIsInitialized(true);
    };

    // 初始化检查
    const initAuth = () => {
      // 检查网关层是否已设置用户信息
      const gatewayUser = (window as any).__YUELI_USER__;
      if (gatewayUser) {
        setUser(gatewayUser);
      }
      setIsInitialized(true);
    };

    window.addEventListener('yueli:auth:change', handleAuthChange as EventListener);
    initAuth();

    return () => {
      window.removeEventListener('yueli:auth:change', handleAuthChange as EventListener);
    };
  }, []);

  /**
   * 刷新认证状态
   * 网关层认证变化后调用此方法同步状态
   */
  const refresh = () => {
    const gatewayUser = (window as any).__YUELI_USER__;
    setUser(gatewayUser || null);
  };

  return (
    <AuthContext.Provider value={{ 
      isInitialized, 
      user,
      refresh
    }}>
      {children}
    </AuthContext.Provider>
  );
};
