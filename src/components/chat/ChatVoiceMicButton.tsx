import React from 'react';
import styled, { keyframes } from 'styled-components';
import { AudioOutlined } from '@ant-design/icons';
import { useMixedLangVoiceInput, isMixedLangSpeechSupported } from '../../hooks/useMixedLangVoiceInput';

const ACCENT = '#4477ff';

const VoiceMicRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

/** 与 YueliCopilot 左侧「+」工具按钮同字号与同内边距，保证图标视觉一致 */
const MicButton = styled.button<{ $active: boolean; $muted: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border: none;
  border-radius: 0;
  background: ${(p) => (p.$active ? 'rgba(68, 119, 255, 0.08)' : 'transparent')};
  color: ${(p) => (p.$muted ? '#bfbfbf' : p.$active ? ACCENT : '#666')};
  cursor: ${(p) => (p.$muted ? 'not-allowed' : 'pointer')};
  font-size: 16px;
  line-height: 1;
  transition: background-color 0.2s, color 0.2s;

  &:hover:not(:disabled) {
    background: ${(p) => (p.$active ? 'rgba(68, 119, 255, 0.12)' : '#f5f5f5')};
  }

  &:disabled {
    opacity: 0.65;
  }

  .anticon {
    font-size: 16px;
  }

  .anticon svg {
    width: 1em;
    height: 1em;
  }
`;

const pulseOpacity = keyframes`
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
`;

const VoiceIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${ACCENT};
  font-size: 12px;
  margin-right: 4px;
  user-select: none;
`;

const VoiceWaveAnimation = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  animation: ${pulseOpacity} 1.5s infinite;
`;

const WaveLine = styled.div<{ $height: number }>`
  width: 2px;
  height: ${(p) => p.$height}px;
  background-color: ${ACCENT};
  border-radius: 2px;
`;

export interface ChatVoiceMicButtonProps {
  appendTranscript: (text: string) => void;
  onInterimChange?: (text: string) => void;
  disabled?: boolean;
}

export const ChatVoiceMicButton: React.FC<ChatVoiceMicButtonProps> = ({
  appendTranscript,
  onInterimChange,
  disabled
}) => {
  const supported = isMixedLangSpeechSupported();

  const { isListening, recordingTime, toggle } = useMixedLangVoiceInput({
    onFinal: appendTranscript,
    onInterim: onInterimChange,
    enabled: !disabled && supported
  });

  const title = !supported
    ? '当前浏览器不支持语音输入'
    : disabled
      ? '发送中不可用'
      : isListening
        ? '点击结束语音输入（Esc 也可结束）'
        : '语音输入（浏览器听写）';

  return (
    <VoiceMicRow>
      <MicButton
        type="button"
        $active={isListening}
        $muted={Boolean(disabled || !supported)}
        disabled={disabled || !supported}
        onClick={() => void toggle()}
        title={title}
        aria-pressed={isListening}
        aria-label={title}
      >
        <AudioOutlined style={{ fontSize: 16 }} />
      </MicButton>
      {isListening ? (
        <VoiceIndicator aria-hidden>
          <VoiceWaveAnimation>
            <WaveLine $height={6} />
            <WaveLine $height={10} />
            <WaveLine $height={14} />
            <WaveLine $height={10} />
            <WaveLine $height={6} />
          </VoiceWaveAnimation>
          {recordingTime > 0 ? `${recordingTime}秒` : null}
        </VoiceIndicator>
      ) : null}
    </VoiceMicRow>
  );
};
