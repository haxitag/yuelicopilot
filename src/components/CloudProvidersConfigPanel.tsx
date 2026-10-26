import React, { useEffect, useState } from 'react';
import {
  type CloudProviderRow,
  mergeCloudProviderRows,
  readYueliaiSubModelsFromLocalStorage,
  splitCloudProviderRows,
  writeYueliaiSubModelsToLocalStorage,
  type YueliaiSubModelRow
} from '../utils/defaultCloudProviders';
import { CLOUD_MAAS_PRESETS, applyCloudLlmPresetToRow } from '../utils/inferenceChatEndpoint';
import CloudProviderModelField from './CloudProviderModelField';

export type CloudProvidersConfigPanelProps = {
  rows: CloudProviderRow[];
  onChange: (rows: CloudProviderRow[]) => void;
  /** manager = SkillManager 较大字号；compact = ApiConfigModal */
  variant?: 'manager' | 'compact';
};

function cardStyle(variant: 'manager' | 'compact'): React.CSSProperties {
  return {
    border: '1px solid #e0e0e0',
    borderRadius: variant === 'manager' ? 8 : 4,
    padding: variant === 'manager' ? 16 : 12,
    marginBottom: variant === 'manager' ? 12 : 8,
    background: variant === 'manager' ? '#fafafa' : '#fff'
  };
}

function sectionTitleStyle(variant: 'manager' | 'compact'): React.CSSProperties {
  return {
    fontSize: variant === 'manager' ? 14 : 13,
    fontWeight: 650,
    color: '#333',
    marginBottom: 8
  };
}

const CloudProvidersConfigPanel: React.FC<CloudProvidersConfigPanelProps> = ({
  rows,
  onChange,
  variant = 'compact'
}) => {
  const { yueliai, maas } = splitCloudProviderRows(rows);
  const [subModels, setSubModels] = useState<YueliaiSubModelRow[]>(() =>
    readYueliaiSubModelsFromLocalStorage()
  );

  useEffect(() => {
    const onChange = () => setSubModels(readYueliaiSubModelsFromLocalStorage());
    window.addEventListener('yueli-cloud-providers-changed', onChange);
    return () => window.removeEventListener('yueli-cloud-providers-changed', onChange);
  }, []);

  const persistSubModels = (next: YueliaiSubModelRow[]) => {
    setSubModels(next);
    writeYueliaiSubModelsToLocalStorage(next);
  };
  const inputFont = variant === 'manager' ? 14 : 12;
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: variant === 'manager' ? '8px 12px' : '4px 8px',
    border: '1px solid #d9d9d9',
    borderRadius: 4,
    fontSize: inputFont,
    boxSizing: 'border-box'
  };

  const setYueliai = (next: CloudProviderRow) => {
    onChange(mergeCloudProviderRows(next, maas));
  };

  const setMaas = (next: CloudProviderRow[]) => {
    onChange(mergeCloudProviderRows(yueliai, next));
  };

  const updateMaasAt = (index: number, patch: Partial<CloudProviderRow>) => {
    const updated = [...maas];
    updated[index] = { ...updated[index], ...patch };
    setMaas(updated);
  };

  return (
    <>
      <section style={{ marginBottom: 16 }}>
        <div style={sectionTitleStyle(variant)}>Yueli AI（第3层 · 云端聚合）</div>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.5 }}>
          在模型下拉选择「Yueli AI / freemodel」或下方子模型时，请求经同源 <code>/yueliai</code> 代理直连 Yueli AI
          聚合 API。API Key 必填；「启用」仅表示同步到 KGM L2 元数据（可选）。
        </p>
        <div style={cardStyle(variant)}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
              gap: 8
            }}
          >
            <span style={{ fontSize: inputFont, fontWeight: 600 }}>{yueliai.name}</span>
            <label style={{ fontSize: inputFont, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={yueliai.enabled}
                onChange={(e) => setYueliai({ ...yueliai, enabled: e.target.checked })}
              />
              启用
            </label>
          </div>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
            端点：<code style={{ fontSize: 11 }}>{yueliai.apiUrl}</code>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
              API Key
            </label>
            <input
              type="text"
              value={yueliai.apiKey}
              onChange={(e) => setYueliai({ ...yueliai, apiKey: e.target.value })}
              style={inputStyle}
              placeholder="sk-..."
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
              模型
            </label>
            <CloudProviderModelField
              presetId="yueliai"
              model={yueliai.model}
              onChange={(model) => setYueliai({ ...yueliai, model })}
              inputStyle={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#333' }}>
            Yueli AI 子模型（第3层手工路径）
          </div>
          <p style={{ fontSize: 11, color: '#888', marginBottom: 8, lineHeight: 1.5 }}>
            例如 <code>deepseek/deepseek-v4-fast</code>，在模型下拉显示为「Yueli AI / …」。
          </p>
          <button
            type="button"
            style={{
              padding: variant === 'manager' ? '6px 12px' : '4px 10px',
              background: '#1890ff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: inputFont,
              marginBottom: 8
            }}
            onClick={() =>
              persistSubModels([
                ...subModels,
                { id: `yueliai_sub_${Date.now()}`, model: '', enabled: true }
              ])
            }
          >
            添加子模型
          </button>
          {subModels.map((sub, idx) => (
            <div key={sub.id} style={{ ...cardStyle(variant), background: '#fff' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: inputFont, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={sub.enabled}
                    onChange={(e) => {
                      const next = [...subModels];
                      next[idx] = { ...sub, enabled: e.target.checked };
                      persistSubModels(next);
                    }}
                  />
                  启用
                </label>
                <button
                  type="button"
                  style={{
                    marginLeft: 'auto',
                    background: 'transparent',
                    border: '1px solid #ff4d4f',
                    color: '#ff4d4f',
                    padding: '2px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                  onClick={() => persistSubModels(subModels.filter((s) => s.id !== sub.id))}
                >
                  删除
                </button>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
                  模型路径（model）
                </label>
                <input
                  type="text"
                  value={sub.model}
                  onChange={(e) => {
                    const next = [...subModels];
                    next[idx] = { ...sub, model: e.target.value };
                    persistSubModels(next);
                  }}
                  style={inputStyle}
                  placeholder="deepseek/deepseek-v4-fast"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
                  显示名（可选）
                </label>
                <input
                  type="text"
                  value={sub.label ?? ''}
                  onChange={(e) => {
                    const next = [...subModels];
                    next[idx] = { ...sub, label: e.target.value };
                    persistSubModels(next);
                  }}
                  style={inputStyle}
                  placeholder="Yueli AI / deepseek / …"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div style={sectionTitleStyle(variant)}>其它云端 MaaS（第2层 · Copilot 直选）</div>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.5 }}>
          第2层：在模型下拉直选时，请求经 KGM 固定 model；须启用并填写 apiKey / model。与 Yueli AI 第3层无上下级关系。
        </p>
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            style={{
              padding: variant === 'manager' ? '8px 16px' : '6px 12px',
              background: '#1890ff',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: variant === 'manager' ? 14 : 12
            }}
            onClick={() => {
              setMaas([
                ...maas,
                {
                  id: `provider_${Date.now()}`,
                  name: 'DeepSeek',
                  enabled: false,
                  apiKey: '',
                  ...applyCloudLlmPresetToRow('deepseek')
                }
              ]);
            }}
          >
            添加 MaaS 服务商
          </button>
        </div>

        {maas.map((provider, index) => (
          <div key={provider.id} style={cardStyle(variant)}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
                gap: 8
              }}
            >
              <input
                type="text"
                value={provider.name}
                onChange={(e) => updateMaasAt(index, { name: e.target.value })}
                style={{ ...inputStyle, width: 200, flex: '0 0 auto' }}
                placeholder="服务商名称"
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: inputFont, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(e) => updateMaasAt(index, { enabled: e.target.checked })}
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
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                  onClick={() => setMaas(maas.filter((p) => p.id !== provider.id))}
                >
                  删除
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
                服务商预设
              </label>
              <select
                value={provider.presetId || 'custom'}
                onChange={(e) => {
                  const v = e.target.value;
                  const patch = applyCloudLlmPresetToRow(v);
                  updateMaasAt(index, {
                    presetId: patch.presetId,
                    apiUrl: v === 'custom' ? provider.apiUrl : patch.apiUrl,
                    model: patch.model || provider.model
                  });
                }}
                style={{ ...inputStyle, maxWidth: 420 }}
              >
                {CLOUD_MAAS_PRESETS.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              {(provider.presetId === 'custom' || !provider.presetId) && (
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
                    API 地址
                  </label>
                  <input
                    type="text"
                    value={provider.apiUrl}
                    onChange={(e) => updateMaasAt(index, { apiUrl: e.target.value })}
                    style={inputStyle}
                    placeholder="https://api.example.com/v1/chat/completions"
                  />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
                  API Key
                </label>
                <input
                  type="text"
                  value={provider.apiKey}
                  onChange={(e) => updateMaasAt(index, { apiKey: e.target.value })}
                  style={inputStyle}
                  placeholder="sk-..."
                />
              </div>
            </div>

            {provider.presetId && provider.presetId !== 'custom' && (
              <div style={{ marginBottom: 8, fontSize: 11, color: '#666' }}>
                对话端点：
                <code style={{ fontSize: 11 }}>
                  {provider.apiUrl || applyCloudLlmPresetToRow(provider.presetId).apiUrl}
                </code>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#666' }}>
                模型版本
              </label>
              <CloudProviderModelField
                presetId={provider.presetId}
                model={provider.model}
                onChange={(model) => updateMaasAt(index, { model })}
                inputStyle={inputStyle}
              />
            </div>
          </div>
        ))}

        {maas.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
            尚未添加其它 MaaS 服务商
          </div>
        )}
      </section>
    </>
  );
};

export default CloudProvidersConfigPanel;
