import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  MixedLangSpeechRecognizer,
  type SpeechRecognitionErrorEvent
} from '../services/speech/MixedLangSpeechRecognizer';

export function isMixedLangSpeechSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export interface UseMixedLangVoiceInputOptions {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  /** 为 false 时不允许开始（例如正在发送） */
  enabled: boolean;
}

/**
 * 与 yueli-deck NewChatDialog 一致：MixedLangSpeechRecognizer + 安全上下文 + 麦克风预检 + 录音秒数。
 */
export function useMixedLangVoiceInput(options: UseMixedLangVoiceInputOptions) {
  const { enabled, onFinal, onInterim } = options;
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;

  const recognizerRef = useRef<MixedLangSpeechRecognizer | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  /** 取消尚未完成的 getUserMedia，避免快速开关竞态 */
  const micSessionRef = useRef(0);

  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current != null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const startRecordingTimer = useCallback(() => {
    setRecordingTime(0);
    clearRecordingTimer();
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingTime((p) => p + 1);
    }, 1000);
  }, [clearRecordingTimer]);

  useEffect(() => {
    const r = new MixedLangSpeechRecognizer();
    recognizerRef.current = r;
    r.setCallbacks(
      (transcript, isFinal) => {
        const t = (transcript || '').trim();
        if (!t) return;
        if (isFinal) {
          onFinalRef.current(t);
          setInterimText('');
          onInterimRef.current?.('');
        } else {
          setInterimText(t);
          onInterimRef.current?.(t);
        }
      },
      (error: SpeechRecognitionErrorEvent) => {
        console.error('[MixedLangVoice]', error.error);
        toast.error(`语音识别错误：${error.error}`);
        setIsListening(false);
        clearRecordingTimer();
        setInterimText('');
        onInterimRef.current?.('');
      },
      () => {
        setIsListening(true);
        setInterimText('');
        onInterimRef.current?.('');
        startRecordingTimer();
      },
      () => {
        setIsListening(false);
        clearRecordingTimer();
        setInterimText('');
        onInterimRef.current?.('');
      }
    );
    return () => {
      r.stop();
      clearRecordingTimer();
    };
  }, [clearRecordingTimer, startRecordingTimer]);

  const stop = useCallback(() => {
    micSessionRef.current += 1;
    clearRecordingTimer();
    recognizerRef.current?.stop();
    setIsListening(false);
    setInterimText('');
    onInterimRef.current?.('');
  }, [clearRecordingTimer]);

  const start = useCallback(async () => {
    if (!enabled) return;
    if (!window.isSecureContext) {
      toast.error('语音输入需要在 HTTPS 或本机 localhost 环境下使用');
      return;
    }
    if (!isMixedLangSpeechSupported()) {
      toast.error('当前浏览器不支持语音输入，请改用键盘输入');
      return;
    }

    const session = ++micSessionRef.current;

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      toast.error('无法访问麦克风：请在浏览器设置中允许麦克风权限后再试');
      return;
    }

    if (session !== micSessionRef.current) return;
    recognizerRef.current?.start();
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (isListening) {
      stop();
      return;
    }
    if (!enabled) return;
    await start();
  }, [enabled, isListening, start, stop]);

  useEffect(() => {
    if (!isListening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isListening, stop]);

  return {
    isListening,
    interimText,
    recordingTime,
    supported: isMixedLangSpeechSupported(),
    start,
    stop,
    toggle
  };
}
