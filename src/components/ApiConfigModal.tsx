import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import apiService from '../api/services/apiService';
import { readCloudProvidersFromLocalStorage } from '../utils/defaultCloudProviders';
import { normalizeCloudProvidersModelsForStorage } from '../utils/cloudLlmPresetModels';
import { saveCloudProvidersWithKgmSync } from '../utils/cloudProviderSaveSync';
import { getSecret, setSecret } from '../utils/secretStore';
import { toast } from 'react-hot-toast';
import CloudProvidersConfigPanel from './CloudProvidersConfigPanel';
import {
  SKILL_TRUSTED_SIGNER_STORAGE_KEY,
  formatTrustedSignersForEditor
} from '../services/core/skillPkgVerification';
import { isSkillEvolutionEnabled, setSkillEvolutionEnabled } from '../services/chat/skillEvolutionPrefs';
import { useEscapeClose } from '../hooks/useEscapeClose';

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
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
`;

const ModalScrollBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
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

const TextArea = styled.textarea`
  width: 100%;
  min-height: 100px;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  box-sizing: border-box;
  resize: vertical;

  &:focus {
    outline: none;
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
  }
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
  flex-shrink: 0;
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

type TabType = 'yueli-kgm' | 'playground' | 'skill-signing';

const ApiConfigModal: React.FC<ApiConfigModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('yueli-kgm');
  useEscapeClose(isOpen, onClose);
  
  const [kgmConfig, setKgmConfig] = useState<ApiConfig>({
    baseUrl: localStorage.getItem('kgmBaseUrl') || import.meta.env.VITE_KGM_BASE_URL || '/kgm',
    apiKey: getSecret('kgmApiKey'),
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
      presetId?: string;
      apiUrl: string;
      apiKey: string;
      model: string;
      enabled: boolean;
    }>;
  }>({
    playgroundUrl: localStorage.getItem('playgroundUrl') || getDefaultPlaygroundUrl(),
    cloudProviders: readCloudProvidersFromLocalStorage()
  });

  const [skillTrustedSignersText, setSkillTrustedSignersText] = useState(() =>
    formatTrustedSignersForEditor()
  );
  const [skillEvolutionEnabled, setSkillEvolutionEnabledUi] = useState(() =>
    isSkillEvolutionEnabled()
  );

  useEffect(() => {
    if (!isOpen) return;
    setKgmConfig({
      baseUrl: localStorage.getItem('kgmBaseUrl') || import.meta.env.VITE_KGM_BASE_URL || 'http://127.0.0.1:3080',
      apiKey: getSecret('kgmApiKey'),
      timeout: parseInt(localStorage.getItem('kgmTimeout') || '60000'),
      ollamaBaseUrl: localStorage.getItem('kgmOllamaBaseUrl') || 'http://localhost:11434'
    });
    setPlaygroundConfig({
      playgroundUrl: localStorage.getItem('playgroundUrl') || getDefaultPlaygroundUrl(),
      cloudProviders: normalizeCloudProvidersModelsForStorage(readCloudProvidersFromLocalStorage())
    });
    setSkillTrustedSignersText(formatTrustedSignersForEditor());
  }, [isOpen]);

  const handleSave = async () => {
    localStorage.setItem('kgmBaseUrl', kgmConfig.baseUrl);
    setSecret('kgmApiKey', kgmConfig.apiKey || '');
    localStorage.setItem('kgmTimeout', kgmConfig.timeout.toString());
    localStorage.setItem('kgmOllamaBaseUrl', kgmConfig.ollamaBaseUrl || '');
    
    localStorage.setItem('playgroundUrl', playgroundConfig.playgroundUrl);

    const sync = await saveCloudProvidersWithKgmSync(
      normalizeCloudProvidersModelsForStorage(playgroundConfig.cloudProviders)
    );
    if (!sync.ok) {
      toast.error(sync.error || '云端配置同步 KGM 失败');
      return;
    }
    if (sync.verifyDetail) {
      toast.success(`云端配置已同步（${sync.verifyDetail}）`);
    }

    const signerLines = skillTrustedSignersText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (signerLines.length > 0) {
      localStorage.setItem(SKILL_TRUSTED_SIGNER_STORAGE_KEY, JSON.stringify(signerLines));
    } else {
      localStorage.removeItem(SKILL_TRUSTED_SIGNER_STORAGE_KEY);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('yueli-cloud-providers-changed'));
    }
    
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
          <Tab
            $active={activeTab === 'skill-signing'}
            onClick={() => setActiveTab('skill-signing')}
          >
            Skill 签名
          </Tab>

        </TabContainer>

        <ModalScrollBody>
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
              <Description>桌面端默认使用 /kgm。</Description>
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
              <Description>慢模型建议 300000 以上。</Description>
              <button
                type="button"
                style={{
                  marginTop: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                  background: '#fafafa',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  const r = apiService.clearKgmCanaryCache();
                  window.alert(r.message);
                }}
              >
                清除 KGM 预检缓存
              </button>
            </FormGroup>

            <FormGroup>
              <Label>Ollama API地址 (可选)</Label>
              <Input
                type="text"
                value={kgmConfig.ollamaBaseUrl || ''}
                onChange={(e) => setKgmConfig(prev => ({ ...prev, ollamaBaseUrl: e.target.value }))}
                placeholder="http://localhost:11434"
              />
              <Description>默认 http://localhost:11434</Description>
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
              <Description>KGM Playground 地址。</Description>
            </FormGroup>

            <FormGroup>
              <Label>云端推理服务商</Label>
              <Description>
                Yueli AI（freemodel）与其它 MaaS 平级配置，保存后同步至 KGM L2 路由元数据。
              </Description>
              <CloudProvidersConfigPanel
                variant="compact"
                rows={playgroundConfig.cloudProviders}
                onChange={(cloudProviders) =>
                  setPlaygroundConfig((prev) => ({
                    ...prev,
                    cloudProviders: normalizeCloudProvidersModelsForStorage(cloudProviders)
                  }))
                }
              />
            </FormGroup>

            <FormGroup>
              <Label>技能进化 / AB 测试</Label>
              <Description>
                关闭后 SkillExecutor 不再写入进化偏好与 AB 分支（适合生产稳定环境）。
              </Description>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={skillEvolutionEnabled}
                  onChange={(e) => {
                    setSkillEvolutionEnabledUi(e.target.checked);
                    setSkillEvolutionEnabled(e.target.checked);
                  }}
                />
                启用技能进化与 AB
              </label>
            </FormGroup>

            <FormGroup>
              <Label>联网搜索（Web Research）</Label>
              <Description>
                优先经 Skill Executor 的 <code>/v1/tools/web_search</code> 与{' '}
                <code>realtime-web-research</code> 技能。可选配置 Jina Reader Key（环境变量{' '}
                <code>JINA_API_KEY</code> 或 Executor 配置）以提升网页正文提取质量；未配置时使用 DuckDuckGo
                等免费源，可能无法读取付费墙页面。
              </Description>
            </FormGroup>
          </>
        )}

        {activeTab === 'skill-signing' && (
          <>
            <FormGroup>
              <Label>可信发布者（公钥 Base64 或指纹）</Label>
              <TextArea
                value={skillTrustedSignersText}
                onChange={(e) => setSkillTrustedSignersText(e.target.value)}
                spellCheck={false}
                placeholder={`每行一条 public_key 或 fp: 指纹\n留空则不限制发布者。`}
              />
              <Description>配置后仅允许列表内发布者安装签名 skillpkg。</Description>
            </FormGroup>
          </>
        )}
        </ModalScrollBody>

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
