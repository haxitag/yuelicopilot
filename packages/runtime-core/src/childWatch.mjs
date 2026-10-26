import { isProcessAlive, curlOk } from './spawn.mjs';

/**
 * 子进程退出后按指数退避重启（desktop / Electron 场景）。
 */
export class ChildRestartWatch {
  /**
   * @param {{
   *   name: string;
   *   getPid: () => number | undefined;
   *   restart: () => Promise<void> | void;
   *   healthUrl?: string;
   *   maxRestarts?: number;
   *   onLog?: (msg: string) => void;
   * }} opts
   */
  constructor(opts) {
    this.name = opts.name;
    this.getPid = opts.getPid;
    this.restart = opts.restart;
    this.healthUrl = opts.healthUrl;
    this.maxRestarts = opts.maxRestarts ?? 8;
    this.onLog = opts.onLog ?? (() => {});
    this.restartCount = 0;
    this.stopped = false;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.healthTimer = null;
  }

  log(msg) {
    this.onLog(`[${this.name}] ${msg}`);
  }

  /**
   * @param {import('node:child_process').ChildProcess} child
   */
  attach(child) {
    child.on('exit', (code, signal) => {
      if (this.stopped) return;
      this.log(`进程退出 code=${code} signal=${signal ?? ''}`);
      void this.scheduleRestart();
    });
  }

  startHealthPoll(intervalMs = 15000) {
    if (!this.healthUrl) return;
    this.healthTimer = setInterval(() => {
      if (this.stopped) return;
      void this.checkHealth();
    }, intervalMs);
  }

  async checkHealth() {
    if (!this.healthUrl) return;
    const pid = this.getPid();
    if (pid && !isProcessAlive(pid)) {
      this.log('健康检查：PID 不存在');
      await this.scheduleRestart();
      return;
    }
    const ok = await curlOk(this.healthUrl, 4000);
    if (!ok) {
      this.log(`健康检查失败: ${this.healthUrl}`);
      await this.scheduleRestart();
    }
  }

  async scheduleRestart() {
    if (this.stopped) return;
    if (this.restartCount >= this.maxRestarts) {
      this.log(`已达最大重启次数 ${this.maxRestarts}，停止自动恢复`);
      return;
    }
    this.restartCount += 1;
    const delay = Math.min(30000, 1000 * 2 ** (this.restartCount - 1));
    this.log(`${delay}ms 后第 ${this.restartCount} 次重启...`);
    await new Promise((r) => setTimeout(r, delay));
    if (this.stopped) return;
    try {
      await this.restart();
      this.log('重启完成');
    } catch (err) {
      this.log(`重启失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  stop() {
    this.stopped = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
  }
}
