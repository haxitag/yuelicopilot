import type { DebugEntry } from '../components/DebugPanel';

class DebugManager {
  private isEnabled = false;
  private entries: DebugEntry[] = [];
  private listeners: Set<(entries: DebugEntry[]) => void> = new Set();

  constructor() {
    const saved = localStorage.getItem('yueli_debug_enabled');
    this.isEnabled = saved === 'true';
  }

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    localStorage.setItem('yueli_debug_enabled', String(enabled));
    this.notifyListeners();
  }

  isEnabledFlag() {
    return this.isEnabled;
  }

  addEntry(entry: Omit<DebugEntry, 'id' | 'timestamp'>) {
    if (!this.isEnabled) return;

    const newEntry: DebugEntry = {
      ...entry,
      id: `${entry.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };

    this.entries = [...this.entries, newEntry];
    this.notifyListeners();
  }

  logRequest(title: string, data: any, startTime?: number) {
    this.addEntry({
      type: 'request',
      title,
      data,
      duration: startTime ? Date.now() - startTime : undefined
    });
  }

  logResponse(title: string, data: any, startTime?: number) {
    this.addEntry({
      type: 'response',
      title,
      data,
      duration: startTime ? Date.now() - startTime : undefined
    });
  }

  logTransform(title: string, data: any) {
    this.addEntry({
      type: 'transform',
      title,
      data
    });
  }

  logError(title: string, data: any) {
    this.addEntry({
      type: 'error',
      title,
      data
    });
  }

  logInfo(title: string, data: any) {
    this.addEntry({
      type: 'info',
      title,
      data
    });
  }

  getEntries() {
    return this.entries;
  }

  clearEntries() {
    this.entries = [];
    this.notifyListeners();
  }

  subscribe(listener: (entries: DebugEntry[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener([...this.entries]));
  }

  toggle() {
    this.setEnabled(!this.isEnabled);
  }
}

export const debugManager = new DebugManager();

export default DebugManager;
