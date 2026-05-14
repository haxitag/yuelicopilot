import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import apiService from '../api/services/apiService';

interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
  timeout: number;
  ollamaBaseUrl?: string;
}

interface ApiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  background-color: #ffffff;
  border-radius: 8px;
  padding: 24px;
  width: 650px;
  max-width: 90vw;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
`;

const ModalTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333333;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #999999;
  transition: color 0.3s;

  &:hover {
    color: #333333;
  }
`;

const TabContainer = styled.div`
  display: flex;
  border-bottom: 1px solid #e0e0e0;
  margin-bottom: 20px;
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 12px 24px;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 500;
  color: ${props => props.$active ? '#1890ff' : '#666666'};
  border-bottom: 2px solid ${props => props.$active ? '#1890ff' : 'transparent'};
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    color: #1890ff;
  }
`;

const FormGroup = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #333333;
`;

const Input = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 14px;
  transition: all 0.3s;

  &:focus {
    outline: none;
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
  }
`;

const Description = styled.p`
  margin: 4px 0 8px 0;
  font-size: 12px;
  color: #999999;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
`;

const Button = styled.button`
  padding: 8px 16px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;

  &.primary {
    background-color: #1890ff;
    color: #ffffff;
    border-color: #1890ff;

    &:hover {
      background-color: #40a9ff;
      border-color: #40a9ff;
    }
  }

  &.secondary {
    background-color: #ffffff;
    color: #666666;

    &:hover {
      border-color: #1890ff;
      color: #1890ff;
    }
  }
`;

type TabType = 'yueli-kgm' | 'playground';

const ApiConfigModal: React.FC<ApiConfigModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('yueli-kgm');
  
  const [kgmConfig, setKgmConfig] = useState<ApiConfig>({
    baseUrl: localStorage.getItem('kgmBaseUrl') || import.meta.env.VITE_KGM_BASE_URL || '/kgm',
    apiKey: localStorage.getItem('kgmApiKey') || '',
    timeout: parseInt(localStorage.getItem('kgmTimeout') || '60000'),
    ollamaBaseUrl: localStorage.getItem('kgmOllamaBaseUrl') || 'http://localhost:11434'
  });

  const getDefaultPlaygroundUrl = () => {
  const viteEnv = (import.meta as any).env || {};
  return viteEnv.VITE_PLAYGROUND_URL || 'http://127.0.0.1:3080';
};

const [playgroundConfig, setPlaygroundConfig] = useState<{
    playgroundUrl: string;
    cloudProviders: Array<{
      id: string;
      name: string;
      apiUrl: string;
      apiKey: string;
      model: string;
      enabled: boolean;
    }>;
  }>({
    playgroundUrl: localStorage.getItem('playgroundUrl') || getDefaultPlaygroundUrl(),
    cloudProviders: JSON.parse(localStorage.getItem('cloudProviders') || '[]').map((p: any) => ({
      ...p,
      model: p.model || ''
    }))
  });

  useEffect(() => {
    if (!isOpen) {
      setKgmConfig({
        baseUrl: localStorage.getItem('kgmBaseUrl') || import.meta.env.VITE_KGM_BASE_URL || 'http://127.0.0.1:3080',
        apiKey: localStorage.getItem('kgmApiKey') || '',
        timeout: parseInt(localStorage.getItem('kgmTimeout') || '60000'),
        ollamaBaseUrl: localStorage.getItem('kgmOllamaBaseUrl') || 'http://localhost:11434'
      });
      setPlaygroundConfig({
        playgroundUrl: localStorage.getItem('playgroundUrl') || getDefaultPlaygroundUrl(),
        cloudProviders: JSON.parse(localStorage.getItem('cloudProviders') || '[]')
      });
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('kgmBaseUrl', kgmConfig.baseUrl);
    localStorage.setItem('kgmApiKey', kgmConfig.apiKey || '');
    localStorage.setItem('kgmTimeout', kgmConfig.timeout.toString());
    localStorage.setItem('kgmOllamaBaseUrl', kgmConfig.ollamaBaseUrl || '');
    
    localStorage.setItem('playgroundUrl', playgroundConfig.playgroundUrl);
    localStorage.setItem('cloudProviders', JSON.stringify(playgroundConfig.cloudProviders));
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalOverlay>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>API配置</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>
        
        <TabContainer>
          <Tab 
            $active={activeTab === 'yueli-kgm'} 
            onClick={() => setActiveTab('yueli-kgm')}
          >
            Yueli-KGM-Computing
          </Tab>
          <Tab 
            $active={activeTab === 'playground'} 
            onClick={() => setActiveTab('playground')}
          >
            Playground & 云端推理
          </Tab>

        </TabContainer>

        {activeTab === 'yueli-kgm' && (
          <>
            <FormGroup>
              <Label>后端API地址</Label>
              <Input
                type="text"
                value={kgmConfig.baseUrl}
                onChange={(e) => setKgmConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="http://127.0.0.1:3000"
              />
              <Description>
                Yueli-KGM-Computing聚合推理服务路由地址，如 http://127.0.0.1:3000
              </Description>
            </FormGroup>

            <FormGroup>
              <Label>API Key (可选)</Label>
              <Input
                type="text"
                value={kgmConfig.apiKey}
                onChange={(e) => setKgmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="输入API Key（如需要）"
              />
            </FormGroup>

            <FormGroup>
              <Label>超时时间 (毫秒)</Label>
              <Input
                type="number"
                value={kgmConfig.timeout}
                onChange={(e) => setKgmConfig(prev => ({ ...prev, timeout: parseInt(e.target.value) || 60000 }))}
                placeholder="60000"
              />
            </FormGroup>

            <FormGroup>
              <Label>Ollama API地址 (可选)</Label>
              <Input
                type="text"
                value={kgmConfig.ollamaBaseUrl || ''}
                onChange={(e) => setKgmConfig(prev => ({ ...prev, ollamaBaseUrl: e.target.value }))}
                placeholder="http://localhost:11434"
              />
              <Description>
                当KGM无法处理时可路由到本地Ollama
              </Description>
            </FormGroup>
          </>
        )}

        {activeTab === 'playground' && (
          <>
            <FormGroup>
              <Label>Playground地址</Label>
              <Input
                type="text"
                value={playgroundConfig.playgroundUrl}
                onChange={(e) => setPlaygroundConfig(prev => ({ ...prev, playgroundUrl: e.target.value }))}
                placeholder="http://127.0.0.1:3000/playground"
              />
              <Description>
                Yueli-KGM-Computing playground地址
              </Description>
            </FormGroup>

            <FormGroup>
              <Label>云端推理服务商</Label>
              <div style={{ marginBottom: '12px' }}>
                <button
                  type="button"
                  style={{
                    padding: '6px 12px',
                    background: '#1890ff',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                  onClick={() => {
                    setPlaygroundConfig(prev => ({
                      ...prev,
                      cloudProviders: [...prev.cloudProviders, {
                        id: `provider_${Date.now()}`,
                        name: '新服务商',
                        apiUrl: '',
                        apiKey: '',
                        model: '',
                        enabled: false
                      }]
                    }));
                  }}
                >
                  添加服务商
                </button>
              </div>
              {playgroundConfig.cloudProviders.map((provider, index) => (
                <div key={provider.id} style={{
                  border: '1px solid #e0e0e0',
                  borderRadius: '4px',
                  padding: '12px',
                  marginBottom: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <input
                      type="text"
                      value={provider.name}
                      onChange={(e) => {
                        const updatedProviders = [...playgroundConfig.cloudProviders];
                        updatedProviders[index].name = e.target.value;
                        setPlaygroundConfig(prev => ({ ...prev, cloudProviders: updatedProviders }));
                      }}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #d9d9d9',
                        borderRadius: '4px',
                        fontSize: '14px',
                        width: '200px'
                      }}
                      placeholder="服务商名称"
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={provider.enabled}
                          onChange={(e) => {
                            const updatedProviders = [...playgroundConfig.cloudProviders];
                            updatedProviders[index].enabled = e.target.checked;
                            setPlaygroundConfig(prev => ({ ...prev, cloudProviders: updatedProviders }));
                          }}
                        />
                        启用
                      </label>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: '1px solid #ff4d4f',
                          color: '#ff4d4f',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                        onClick={() => {
                          const updatedProviders = playgroundConfig.cloudProviders.filter(p => p.id !== provider.id);
                          setPlaygroundConfig(prev => ({ ...prev, cloudProviders: updatedProviders }));
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#666' }}>
                        API地址
                      </label>
                      <input
                        type="text"
                        value={provider.apiUrl}
                        onChange={(e) => {
                          const updatedProviders = [...playgroundConfig.cloudProviders];
                          updatedProviders[index].apiUrl = e.target.value;
                          setPlaygroundConfig(prev => ({ ...prev, cloudProviders: updatedProviders }));
                        }}
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          border: '1px solid #d9d9d9',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}
                        placeholder="https://api.example.com/v1"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#666' }}>
                        API Key
                      </label>
                      <input
                        type="text"
                        value={provider.apiKey}
                        onChange={(e) => {
                          const updatedProviders = [...playgroundConfig.cloudProviders];
                          updatedProviders[index].apiKey = e.target.value;
                          setPlaygroundConfig(prev => ({ ...prev, cloudProviders: updatedProviders }));
                        }}
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          border: '1px solid #d9d9d9',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}
                        placeholder="sk-..."
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#666' }}>
                        模型版本
                      </label>
                      <input
                        type="text"
                        value={provider.model}
                        onChange={(e) => {
                          const updatedProviders = [...playgroundConfig.cloudProviders];
                          updatedProviders[index].model = e.target.value;
                          setPlaygroundConfig(prev => ({ ...prev, cloudProviders: updatedProviders }));
                        }}
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          border: '1px solid #d9d9d9',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}
                        placeholder="如：gpt-4o-mini"
                      />
                    </div>
                  </div>
                </div>
              ))}
              {playgroundConfig.cloudProviders.length === 0 && (
                <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                  暂无云端推理服务商配置
                </div>
              )}
            </FormGroup>
          </>
        )}

        <ModalFooter>
          <Button className="secondary" onClick={onClose}>
            取消
          </Button>
          <Button className="primary" onClick={handleSave}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </ModalOverlay>
  );
};

export default ApiConfigModal;