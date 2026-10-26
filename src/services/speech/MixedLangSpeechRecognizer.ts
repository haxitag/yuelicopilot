/**
 * 混合语言语音识别（Web Speech API），与 yueli-deck NewChatDialog 所用逻辑对齐。
 */

export interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      0: { transcript: string; confidence: number };
    };
  };
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export class MixedLangSpeechRecognizer {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;
  private onResultCallback: ((transcript: string, isFinal: boolean) => void) | null = null;
  private onErrorCallback: ((error: SpeechRecognitionErrorEvent) => void) | null = null;
  private onStartCallback: (() => void) | null = null;
  private onEndCallback: (() => void) | null = null;

  constructor() {
    this.setupRecognition();
  }

  private setupRecognition() {
    try {
      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        console.error('[MixedLangSpeechRecognizer] 浏览器不支持 Web Speech API');
        return;
      }

      this.recognition = new SpeechRecognitionCtor();
      if (!this.recognition) return;

      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'zh-CN';
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += transcript;
          else interimTranscript += transcript;
        }
        if (finalTranscript && this.onResultCallback) {
          this.onResultCallback(finalTranscript, true);
        } else if (interimTranscript && this.onResultCallback) {
          this.onResultCallback(interimTranscript, false);
        }
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        this.onErrorCallback?.(event);
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.onEndCallback?.();
      };

      this.recognition.onstart = () => {
        this.isListening = true;
        this.onStartCallback?.();
      };
    } catch (err) {
      console.error('[MixedLangSpeechRecognizer] 初始化失败:', err);
    }
  }

  setCallbacks(
    onResult: (transcript: string, isFinal: boolean) => void,
    onError?: (error: SpeechRecognitionErrorEvent) => void,
    onStart?: () => void,
    onEnd?: () => void
  ) {
    this.onResultCallback = onResult;
    this.onErrorCallback = onError ?? null;
    this.onStartCallback = onStart ?? null;
    this.onEndCallback = onEnd ?? null;
  }

  start() {
    if (!this.recognition) this.setupRecognition();
    if (!this.recognition) return;
    try {
      if (!this.isListening) {
        this.recognition.start();
      }
    } catch (err) {
      console.error('[MixedLangSpeechRecognizer] start 失败:', err);
    }
  }

  stop() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch (err) {
      console.error('[MixedLangSpeechRecognizer] stop 失败:', err);
    }
    this.isListening = false;
  }
}
