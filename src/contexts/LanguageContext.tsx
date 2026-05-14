import React, { createContext, useState, useContext, useEffect } from 'react';

interface LanguageContextType {
  t: (key: string) => string;
  currentLang: string;
  setLanguage: (lang: string) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

interface LanguageProviderProps {
  children: React.ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const [currentLang, setCurrentLang] = useState<string>(() => {
    const savedLang = localStorage.getItem('language');
    return savedLang || 'zh';
  });

  useEffect(() => {
    localStorage.setItem('language', currentLang);
  }, [currentLang]);

  const t = (key: string) => {
    // 简单的翻译函数，实际应用中可以使用i18next等库
    const translations = {
      zh: {
        'chat.title': '智能聊天',
        'chat.send': '发送',
        'chat.loading': '加载中',
        'chat.error': '错误',
        'config.title': '配置',
        'config.api': 'API配置',
        'config.knowledge': '知识库',
        'knowledge.local': '本地文件夹',
        'knowledge.remote': '远程知识库'
      },
      en: {
        'chat.title': 'Smart Chat',
        'chat.send': 'Send',
        'chat.loading': 'Loading',
        'chat.error': 'Error',
        'config.title': 'Configuration',
        'config.api': 'API Configuration',
        'config.knowledge': 'Knowledge Base',
        'knowledge.local': 'Local Folder',
        'knowledge.remote': 'Remote Knowledge Base'
      }
    };

    return (translations[(currentLang as 'zh' | 'en')] as any)?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ t, currentLang, setLanguage: setCurrentLang }}>
      {children}
    </LanguageContext.Provider>
  );
};