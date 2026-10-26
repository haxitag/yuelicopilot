import React, { useEffect } from 'react';
import { coerceCloudLlmPresetModel, listCloudLlmPresetModels } from '../utils/cloudLlmPresetModels';

type CloudProviderModelFieldProps = {
  presetId?: string;
  model: string;
  onChange: (model: string) => void;
  inputStyle?: React.CSSProperties;
  hintStyle?: React.CSSProperties;
};

const CloudProviderModelField: React.FC<CloudProviderModelFieldProps> = ({
  presetId,
  model,
  onChange,
  inputStyle,
  hintStyle
}) => {
  const choices = listCloudLlmPresetModels(presetId);
  const isCustom = !presetId || presetId === 'custom' || choices.length === 0;

  useEffect(() => {
    if (isCustom || choices.length === 0) return;
    const coerced = coerceCloudLlmPresetModel(presetId, model);
    if (coerced !== model) onChange(coerced);
  }, [presetId, model, isCustom, choices.length, onChange]);

  if (isCustom) {
    return (
      <>
        <input
          type="text"
          value={model}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
          placeholder="自定义服务商请填写官方 model 字段"
        />
        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', ...hintStyle }}>
          选「自定义」时需自行填写与上游 API 一致的 model 名称。
        </div>
      </>
    );
  }

  const value = choices.includes(model) ? model : choices[0];

  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      >
        {choices.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', ...hintStyle }}>
        从该 MaaS 服务商预置模型列表中选择，避免与 KGM 路由登记名不一致。
      </div>
    </>
  );
};

export default CloudProviderModelField;
