import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Steps, Button, Typography, Alert, Spin, Input } from 'antd';
import { toast } from 'react-hot-toast';
import {
  rankFirstRunRouteCandidates,
  type FirstRunRouteCandidate
} from '../services/chat/InferenceRouter';
import { waitForKgmRouteReady } from '../services/StartupSelfCheck';
import {
  isBuiltinYueliaiProvider,
  mergeCloudProviderRows,
  readCloudProvidersFromLocalStorage,
  splitCloudProviderRows
} from '../utils/defaultCloudProviders';
import { saveCloudProvidersWithKgmSync } from '../utils/cloudProviderSaveSync';
import {
  isFirstRunComplete,
  markFirstRunComplete,
  markFirstRunSkipped
} from '../services/chat/firstRunStorage';
import { probeOllama, pullOllamaModel } from '../utils/ollamaBootstrap';

export interface FirstRunWizardProps {
  onApplied?: (provider: string, model: string) => void;
}

const FirstRunWizard: React.FC<FirstRunWizardProps> = ({ onApplied }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [kgmOk, setKgmOk] = useState(false);
  const [kgmDetail, setKgmDetail] = useState('');
  const [candidates, setCandidates] = useState<FirstRunRouteCandidate[]>([]);
  const [selected, setSelected] = useState<FirstRunRouteCandidate | null>(null);
  const [yueliaiKey, setYueliaiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaPulling, setOllamaPulling] = useState(false);

  useEffect(() => {
    if (isFirstRunComplete()) return;
    setOpen(true);
    setCandidates(rankFirstRunRouteCandidates());
    setSelected(rankFirstRunRouteCandidates()[0] ?? null);
  }, []);

  const probeKgm = useCallback(async () => {
    setBusy(true);
    setKgmDetail('正在等待 KGM 就绪…');
    const r = await waitForKgmRouteReady({ timeoutMs: 45_000, intervalMs: 1200 });
    setKgmOk(r.ok);
    setKgmDetail(r.ok ? 'KGM 已就绪' : `KGM 未就绪（${r.status || '无响应'}）`);
    setBusy(false);
    if (r.ok) setStep(1);
  }, []);

  useEffect(() => {
    if (!open || step !== 1) return;
    void probeOllama().then((r) => {
      setOllamaOk(r.ok);
      setOllamaModels(r.models);
    });
  }, [open, step]);

  useEffect(() => {
    if (open && step === 0) void probeKgm();
  }, [open, step, probeKgm]);

  const applyRoute = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      if (selected.tier === 'L3' && yueliaiKey.trim()) {
        const rows = readCloudProvidersFromLocalStorage();
        const { yueliai, maas } = splitCloudProviderRows(rows);
        const nextYueliai = isBuiltinYueliaiProvider(yueliai)
          ? { ...yueliai, apiKey: yueliaiKey.trim() }
          : yueliai;
        const sync = await saveCloudProvidersWithKgmSync(
          mergeCloudProviderRows(nextYueliai, maas)
        );
        if (!sync.syncOk) {
          toast.error(sync.error || '同步 KGM 失败');
        }
      }
      localStorage.setItem('selectedProvider', selected.provider);
      localStorage.setItem('selectedModel', selected.model);
      localStorage.setItem('kgmScheduleStrategy', 'kgm-dynamic');
      markFirstRunComplete();
      onApplied?.(selected.provider, selected.model);
      toast.success(`已选择：${selected.label}`);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      title="欢迎使用 Yueli Copilot"
      closable={false}
      maskClosable={false}
      footer={null}
      width={520}
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 20 }}
        items={[{ title: '检测服务' }, { title: '选择推理' }, { title: '完成' }]}
      />
      {step === 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          {busy ? <Spin /> : null}
          <Typography.Paragraph type={kgmOk ? 'success' : 'secondary'}>
            {kgmDetail || '检测本地 KGM…'}
          </Typography.Paragraph>
          {!kgmOk && !busy && (
            <Button type="primary" onClick={() => void probeKgm()}>
              重试
            </Button>
          )}
        </div>
      )}
      {step === 1 && (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            推荐按可用性自动排序。高级用户可在「+ → 模型」中切换三层技术选项。
          </Typography.Paragraph>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map((c) => (
              <button
                key={`${c.provider}:${c.model}`}
                type="button"
                onClick={() => setSelected(c)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border:
                    selected?.provider === c.provider && selected?.model === c.model
                      ? '2px solid #1890ff'
                      : '1px solid #e0e0e0',
                  background: '#fafafa',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{c.reason}</div>
              </button>
            ))}
          </div>
          {selected?.tier === 'L3' && !readCloudProvidersFromLocalStorage().find(isBuiltinYueliaiProvider)?.apiKey?.trim() && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Yueli AI API Key（安装后填写，非仅构建时变量）
              </Typography.Text>
              <Input
                value={yueliaiKey}
                onChange={(e) => setYueliaiKey(e.target.value)}
                placeholder="sk-..."
                style={{ marginTop: 4 }}
              />
            </div>
          )}
          {ollamaOk === false && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="未检测到 Ollama"
              description="本地推理可安装 Ollama 并拉取模型，或使用上方云端方案。"
            />
          )}
          {ollamaOk && ollamaModels.length === 0 && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Ollama 已运行，尚未安装模型。可一键拉取推荐模型（体积较大，请耐心等待）：
              </Typography.Text>
              <Button
                size="small"
                style={{ marginTop: 8 }}
                loading={ollamaPulling}
                onClick={() => {
                  setOllamaPulling(true);
                  void pullOllamaModel('qwen2.5:3b').then((r) => {
                    setOllamaPulling(false);
                    if (r.ok) {
                      toast.success('已拉取 qwen2.5:3b');
                      void probeOllama().then((p) => setOllamaModels(p.models));
                    } else {
                      toast.error(r.error || '拉取失败');
                    }
                  });
                }}
              >
                拉取 qwen2.5:3b
              </Button>
            </div>
          )}
          {ollamaOk && ollamaModels.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
              Ollama 已安装模型：{ollamaModels.slice(0, 5).join(', ')}
              {ollamaModels.length > 5 ? '…' : ''}
            </Typography.Text>
          )}
        </>
      )}
      {step === 2 && (
        <Alert
          type="success"
          message="配置已应用"
          description="可在顶部「配置」或工具箱「+ → 模型」中随时调整。"
        />
      )}
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button
          onClick={() => {
            markFirstRunSkipped();
            setOpen(false);
          }}
        >
          跳过
        </Button>
        {step === 1 && (
          <Button type="primary" loading={busy} onClick={() => void applyRoute()}>
            使用该方案
          </Button>
        )}
        {step === 0 && kgmOk && (
          <Button type="primary" onClick={() => setStep(1)}>
            下一步
          </Button>
        )}
      </div>
    </Modal>
  );
};

export default FirstRunWizard;
