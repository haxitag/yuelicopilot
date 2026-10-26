import { devLog } from './devConsole';

const PORT_MIGRATION_KEY = 'yueli_port_migration_v1';
const CURRENT_PORT_KEY = 'yueli_last_port';
const EXPORT_KEY = 'yueli_data_export';

interface PortMigrationData {
  lastPort: number;
  lastTimestamp: number;
  allData: Record<string, string>;
  [key: string]: any;
}

export function migrateFromOldPort(newPort: number): void {
  try {
    const migrationData = localStorage.getItem(PORT_MIGRATION_KEY);
    const now = Date.now();

    if (migrationData) {
      const data: PortMigrationData = JSON.parse(migrationData);
      const timeSinceLastMigration = now - data.lastTimestamp;

      if (data.lastPort === newPort) {
        devLog('[PortMigration] 同一端口，无需迁移');
        return;
      }

      if (timeSinceLastMigration < 60000) {
        devLog('[PortMigration] 60秒内已迁移过，跳过');
        return;
      }
    }

    const allKeys = Object.keys(localStorage);
    const allData: Record<string, string> = {};

    allKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        allData[key] = value;
      }
    });

    const migrationRecord: PortMigrationData = {
      lastPort: newPort,
      lastTimestamp: now,
      allData
    };

    localStorage.setItem(PORT_MIGRATION_KEY, JSON.stringify(migrationRecord));
    devLog('[PortMigration] 端口迁移数据已保存:', { from: migrationData ? JSON.parse(migrationData).lastPort : 'unknown', to: newPort, keysCount: Object.keys(allData).length });

  } catch (error) {
    console.error('[PortMigration] 迁移失败:', error);
  }
}

export function restoreFromMigration(newPort: number): boolean {
  try {
    const migrationData = localStorage.getItem(PORT_MIGRATION_KEY);
    if (!migrationData) {
      devLog('[PortMigration] 无迁移数据');
      return false;
    }

    const data: PortMigrationData = JSON.parse(migrationData);

    if (data.lastPort === newPort) {
      devLog('[PortMigration] 已是最新端口');
      return false;
    }

    devLog('[PortMigration] 开始恢复数据 from port', data.lastPort, 'to', newPort, '共', Object.keys(data.allData || {}).length, '项');

    if (data.allData) {
      Object.entries(data.allData).forEach(([key, value]) => {
        localStorage.setItem(key, value as string);
      });
    }

    devLog('[PortMigration] 数据恢复成功');
    return true;

  } catch (error) {
    console.error('[PortMigration] 恢复失败:', error);
    return false;
  }
}

export function checkAndMigratePort(): void {
  const currentPort = window.location.port;
  const portNumber = parseInt(currentPort);

  if (isNaN(portNumber) || portNumber === 0) {
    return;
  }

  localStorage.setItem(CURRENT_PORT_KEY, currentPort);

  const migrationData = localStorage.getItem(PORT_MIGRATION_KEY);
  if (migrationData) {
    const data: PortMigrationData = JSON.parse(migrationData);
    if (data.lastPort !== portNumber) {
      restoreFromMigration(portNumber);
    }
  } else {
    migrateFromOldPort(portNumber);
  }
}

export function triggerManualMigration(fromPort: number, toPort: number): boolean {
  try {
    devLog(`[PortMigration] 手动触发迁移: ${fromPort} -> ${toPort}`);

    const allKeys = Object.keys(localStorage);
    const allData: Record<string, string> = {};

    let migratedCount = 0;
    allKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        allData[key] = value;
        migratedCount++;
        devLog(`[PortMigration] 迁移 key: ${key}`);
      }
    });

    const migrationRecord: PortMigrationData = {
      lastPort: toPort,
      lastTimestamp: Date.now(),
      allData
    };

    localStorage.setItem(PORT_MIGRATION_KEY, JSON.stringify(migrationRecord));
    devLog(`[PortMigration] 手动迁移完成，共迁移 ${migratedCount} 项数据`);
    return true;

  } catch (error) {
    console.error('[PortMigration] 手动迁移失败:', error);
    return false;
  }
}

export function exportAllData(): string {
  try {
    const allKeys = Object.keys(localStorage);
    const allData: Record<string, string> = {};

    allKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        allData[key] = value;
      }
    });

    const exportData = {
      version: 1,
      timestamp: Date.now(),
      port: window.location.port,
      data: allData
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    devLog(`[PortMigration] 导出完成，共 ${Object.keys(allData).length} 项数据`);

    return jsonString;

  } catch (error) {
    console.error('[PortMigration] 导出失败:', error);
    return '';
  }
}

export function importAllData(jsonString: string): boolean {
  try {
    const importData = JSON.parse(jsonString);

    if (!importData.data || typeof importData.data !== 'object') {
      console.error('[PortMigration] 无效的导入数据格式');
      return false;
    }

    let importedCount = 0;
    Object.entries(importData.data).forEach(([key, value]) => {
      localStorage.setItem(key, value as string);
      importedCount++;
    });

    devLog(`[PortMigration] 导入完成，共 ${importedCount} 项数据`);
    devLog('[PortMigration] 请刷新页面以加载数据');
    return true;

  } catch (error) {
    console.error('[PortMigration] 导入失败:', error);
    return false;
  }
}

export function downloadExportedData(): void {
  try {
    const jsonString = exportAllData();
    if (!jsonString) {
      console.error('[PortMigration] 导出数据为空');
      return;
    }

    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yueli-data-export-${window.location.port}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    devLog('[PortMigration] 文件已下载');

  } catch (error) {
    console.error('[PortMigration] 下载失败:', error);
  }
}

export function uploadAndImportData(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const success = importAllData(content);
        resolve(success);
      } else {
        console.error('[PortMigration] 文件读取失败');
        resolve(false);
      }
    };
    reader.onerror = () => {
      console.error('[PortMigration] 文件读取器错误');
      resolve(false);
    };
    reader.readAsText(file);
  });
}

export function clearMigrationData(): void {
  localStorage.removeItem(PORT_MIGRATION_KEY);
  devLog('[PortMigration] 迁移数据已清除');
}

export function showMigrationData(): void {
  const migrationData = localStorage.getItem(PORT_MIGRATION_KEY);
  if (migrationData) {
    const data = JSON.parse(migrationData);
    devLog('[PortMigration] 当前迁移数据:', data);
    devLog('[PortMigration] 包含的 keys:', Object.keys(data.allData || {}));
  } else {
    devLog('[PortMigration] 无迁移数据');
  }
}

export function showAllLocalStorage(): void {
  const allKeys = Object.keys(localStorage);
  devLog(`[PortMigration] 当前 localStorage 共 ${allKeys.length} 项数据:`);
  allKeys.forEach(key => {
    const value = localStorage.getItem(key);
    const preview = value && value.length > 100 ? value.substring(0, 100) + '...' : value;
    devLog(`  ${key}: ${preview}`);
  });
}

(window as any).triggerPortMigration = (fromPort: number, toPort: number) => {
  return triggerManualMigration(fromPort, toPort);
};

(window as any).exportAllData = exportAllData;
(window as any).downloadExportedData = downloadExportedData;
(window as any).importAllData = importAllData;
(window as any).uploadAndImportData = (file: File) => uploadAndImportData(file);
(window as any).clearMigrationData = clearMigrationData;
(window as any).showMigrationData = showMigrationData;
(window as any).showAllLocalStorage = showAllLocalStorage;

devLog('[PortMigration] 端口迁移工具已加载');
devLog('[PortMigration] 可用命令:');
devLog('[PortMigration]   triggerPortMigration(from, to)   - 执行迁移');
devLog('[PortMigration]   exportAllData()                 - 导出所有数据到控制台');
devLog('[PortMigration]   downloadExportedData()            - 下载数据文件');
devLog('[PortMigration]   importAllData(jsonString)        - 从JSON导入');
devLog('[PortMigration]   uploadAndImportData(file)        - 上传文件导入');
devLog('[PortMigration]   showAllLocalStorage()            - 查看所有数据');
devLog('[PortMigration]   showMigrationData()              - 查看迁移数据');
devLog('[PortMigration]   clearMigrationData()             - 清除迁移数据');