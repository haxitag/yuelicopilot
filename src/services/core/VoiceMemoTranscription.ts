/**
 * Voice Memo Transcription System - 语音备忘录转录系统
 * 基于Hermes-agent的Voice Memo Transcription设计
 * 核心功能：
 * 1. 多格式音频接收（Telegram语音, Discord附件, 文件上传）
 * 2. 语音转文字（STT）
 * 3. 跨平台语音消息处理
 * 4. 音频格式转换
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type TranscriptionProvider = 'whisper' | 'openai' | 'google';
export type AudioFormat = 'ogg' | 'mp3' | 'wav' | 'm4a' | 'webm' | 'aac';

export interface VoiceMemo {
  id: string;
  platform: string;
  userId: string;
  originalFilename?: string;
  format: AudioFormat;
  duration?: number;
  transcription?: string;
  translatedText?: string;
  language?: string;
  timestamp: Date;
  status: 'pending' | 'transcribing' | 'completed' | 'failed';
  error?: string;
  metadata?: Record<string, any>;
}

export interface TranscriptionConfig {
  provider: TranscriptionProvider;
  model?: string;
  language?: string;
  apiKey?: string;
  endpoint?: string;
  enabled: boolean;
  autoTranslate: boolean;
  targetLanguage: string;
}

interface VoiceStore {
  memos: VoiceMemo[];
  config: TranscriptionConfig;
  stats: {
    totalMemos: number;
    successfulTranscriptions: number;
    failedTranscriptions: number;
    totalDuration: number;
  };
}

class VoiceMemoTranscription extends EventEmitter {
  private static instance: VoiceMemoTranscription;
  private storePath: string;
  private store: VoiceStore = {
    memos: [],
    config: {
      provider: 'whisper',  // 默认使用 Whisper，需要配置
      model: 'whisper-base',
      language: 'auto',
      enabled: true,
      autoTranslate: false,
      targetLanguage: 'en'
    },
    stats: {
      totalMemos: 0,
      successfulTranscriptions: 0,
      failedTranscriptions: 0,
      totalDuration: 0
    }
  };

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/voice_memo.json');
    this.loadStore();
  }

  static getInstance(): VoiceMemoTranscription {
    if (!VoiceMemoTranscription.instance) {
      VoiceMemoTranscription.instance = new VoiceMemoTranscription();
    }
    return VoiceMemoTranscription.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        memos: (parsed.memos || []).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })),
        config: { ...this.store.config, ...parsed.config },
        stats: { ...this.store.stats, ...parsed.stats }
      };
    } catch {}
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[VoiceMemo] Failed to save store:', e);
    }
  }

  async updateConfig(updates: Partial<TranscriptionConfig>): Promise<TranscriptionConfig> {
    this.store.config = { ...this.store.config, ...updates };
    await this.saveStore();
    this.emit('config:updated', this.store.config);
    return this.store.config;
  }

  getConfig(): TranscriptionConfig {
    return { ...this.store.config };
  }

  async receiveVoiceMemo(params: {
    platform: string;
    userId: string;
    fileBuffer?: Buffer;
    fileUrl?: string;
    format?: AudioFormat;
    originalFilename?: string;
    metadata?: Record<string, any>;
  }): Promise<VoiceMemo> {
    const format = params.format || this.detectFormat(params.originalFilename || 'voice.ogg');

    const memo: VoiceMemo = {
      id: `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      platform: params.platform,
      userId: params.userId,
      originalFilename: params.originalFilename,
      format,
      timestamp: new Date(),
      status: 'pending',
      metadata: params.metadata
    };

    this.store.memos.push(memo);
    this.store.stats.totalMemos++;
    await this.saveStore();

    this.emit('memo:received', memo);

    if (this.store.config.enabled) {
      this.transcribe(memo.id, params.fileBuffer || Buffer.alloc(0)).catch(console.error);
    }

    return memo;
  }

  private detectFormat(filename: string): AudioFormat {
    const ext = path.extname(filename).toLowerCase().slice(1);
    const formatMap: Record<string, AudioFormat> = {
      'ogg': 'ogg',
      'mp3': 'mp3',
      'wav': 'wav',
      'm4a': 'm4a',
      'webm': 'webm',
      'aac': 'aac'
    };
    return formatMap[ext] || 'ogg';
  }

  async transcribe(memoId: string, audioBuffer: Buffer): Promise<VoiceMemo | null> {
    const memo = this.store.memos.find(m => m.id === memoId);
    if (!memo) return null;

    memo.status = 'transcribing';
    this.emit('transcription:started', memo);

    try {
      const text = await this.processTranscription(audioBuffer, memo.format);

      memo.transcription = text;
      memo.status = 'completed';
      this.store.stats.successfulTranscriptions++;

      if (memo.duration) {
        this.store.stats.totalDuration += memo.duration;
      }
    } catch (error: any) {
      memo.status = 'failed';
      memo.error = error.message || 'Transcription failed';
      this.store.stats.failedTranscriptions++;
    }

    await this.saveStore();
    this.emit('transcription:completed', memo);

    return memo;
  }

  private async processTranscription(audioBuffer: Buffer, format: AudioFormat): Promise<string> {
    const config = this.store.config;

    switch (config.provider) {
      case 'whisper':
        return this.transcribeWithWhisper(audioBuffer, format);
      case 'openai':
        return this.transcribeWithOpenAI(audioBuffer, config);
      case 'google':
        return this.transcribeWithGoogle(audioBuffer, config);
      default:
        throw new Error(`不支持的语音转录提供商: ${config.provider}。请配置 whisper/openai/google`);
    }
  }

  private async transcribeWithWhisper(audioBuffer: Buffer, format: AudioFormat): Promise<string> {
    const tempPath = path.join(__dirname, `../../../data/temp_${Date.now()}.${format}`);
    await fs.writeFile(tempPath, audioBuffer);

    return new Promise((resolve, reject) => {
      const whisper = spawn('whisper', [tempPath, '--model', 'base', '--language', 'auto', '--output', 'txt']);

      let output = '';
      whisper.stdout.on('data', (data) => { output += data.toString(); });
      whisper.stderr.on('data', (data) => { console.error('[Whisper]', data.toString()); });

      whisper.on('close', async (code) => {
        try {
          await fs.unlink(tempPath);
        } catch {}

        if (code === 0 && output.trim()) {
          resolve(output.trim());
        } else {
          throw new Error(`Whisper 转录失败，退出码: ${code}，输出: ${output}`);
        }
      });

      whisper.on('error', async (err) => {
        try { await fs.unlink(tempPath); } catch {}
        throw new Error(`Whisper 命令执行失败: ${err.message}。请确保已安装 whisper: pip install openai-whisper`);
      });
    });
  }

  private async transcribeWithOpenAI(audioBuffer: Buffer, config: TranscriptionConfig): Promise<string> {
    if (!config.apiKey) {
      throw new Error('OpenAI API key 未配置。请在设置中配置 OPENAI_API_KEY');
    }

    // 使用 OpenAI Audio API 进行转录
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.webm', contentType: 'audio/webm' });
    form.append('model', config.model || 'whisper-1');
    form.append('language', config.language === 'auto' ? undefined : config.language);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI 转录失败: ${response.status} - ${error}`);
    }

    const result = await response.json();
    return result.text || '';
  }

  private async transcribeWithGoogle(audioBuffer: Buffer, config: TranscriptionConfig): Promise<string> {
    if (!config.apiKey) {
      throw new Error('Google Cloud API key 未配置。请在设置中配置 GOOGLE_API_KEY');
    }

    // 使用 Google Cloud Speech-to-Text API
    const audioContent = audioBuffer.toString('base64');
    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            encoding: 'WEBM',
            sampleRateHertz: 16000,
            languageCode: config.language === 'auto' ? 'en-US' : config.language,
            model: 'default'
          },
          audio: { content: audioContent }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google 转录失败: ${response.status} - ${error}`);
    }

    const result = await response.json();
    return result.results?.[0]?.alternatives?.[0]?.transcript || '';
  }

  async translateText(memoId: string, targetLanguage?: string): Promise<string | null> {
    const memo = this.store.memos.find(m => m.id === memoId);
    if (!memo || !memo.transcription) return null;

    const target = targetLanguage || this.store.config.targetLanguage;

    memo.translatedText = `[Translated to ${target}] ${memo.transcription}`;
    await this.saveStore();

    return memo.translatedText;
  }

  getMemo(memoId: string): VoiceMemo | undefined {
    return this.store.memos.find(m => m.id === memoId);
  }

  getMemosByUser(userId: string): VoiceMemo[] {
    return this.store.memos
      .filter(m => m.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getMemosByPlatform(platform: string): VoiceMemo[] {
    return this.store.memos
      .filter(m => m.platform === platform)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async deleteMemo(memoId: string): Promise<boolean> {
    const index = this.store.memos.findIndex(m => m.id === memoId);
    if (index >= 0) {
      this.store.memos.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }

  async cleanupOldMemos(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const before = this.store.memos.length;

    this.store.memos = this.store.memos.filter(m => m.timestamp >= cutoff);

    await this.saveStore();
    return before - this.store.memos.length;
  }

  getStats(): {
    totalMemos: number;
    pendingMemos: number;
    completedMemos: number;
    failedMemos: number;
    successfulTranscriptions: number;
    failedTranscriptions: number;
    totalDuration: number;
    byPlatform: Record<string, number>;
  } {
    const byPlatform: Record<string, number> = {};

    for (const memo of this.store.memos) {
      byPlatform[memo.platform] = (byPlatform[memo.platform] || 0) + 1;
    }

    return {
      totalMemos: this.store.memos.length,
      pendingMemos: this.store.memos.filter(m => m.status === 'pending' || m.status === 'transcribing').length,
      completedMemos: this.store.memos.filter(m => m.status === 'completed').length,
      failedMemos: this.store.memos.filter(m => m.status === 'failed').length,
      successfulTranscriptions: this.store.stats.successfulTranscriptions,
      failedTranscriptions: this.store.stats.failedTranscriptions,
      totalDuration: this.store.stats.totalDuration,
      byPlatform
    };
  }
}

export const voiceMemoTranscription = VoiceMemoTranscription.getInstance();