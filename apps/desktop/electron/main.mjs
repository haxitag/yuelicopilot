import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell, dialog, Tray, nativeImage, ipcMain } from 'electron';
import { getApplicationSupportDir, getBundledAppRoot } from './appPaths.mjs';
import {
  bootBackendWithWatchdog,
  requestBackendRestart,
  stopBackendWatchdog,
} from './backendWatchdog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/;

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
};

/** @param {string} filePath */
function mimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** @returns {Electron.NativeImage | undefined} */
function loadAppIcon() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [path.join(__dirname, '..', 'build', 'icon.png')];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return nativeImage.createFromPath(p);
    }
  }
  return undefined;
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
let gatewayBaseUrl = '';

function isAllowedNavigation(url) {
  return ALLOWED_ORIGIN_RE.test(url);
}

/** 停靠式 DevTools，避免 detach 窗口触发 Chromium「Runtime agent is not enabled」刷屏 */
function openAppDevTools(wc = mainWindow?.webContents) {
  if (!wc || wc.isDestroyed()) return false;
  const url = wc.getURL();
  if (url.startsWith('data:') || url === 'about:blank') {
    return false;
  }
  wc.openDevTools({ mode: 'right', activate: true });
  return true;
}

function attachWebContentsDebugMenu(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      {
        label: '检查元素',
        click: () => {
          if (!wc.isDestroyed()) wc.inspectElement(params.x, params.y);
        },
      },
      {
        label: '开发者工具',
        accelerator: 'Alt+Command+I',
        click: () => openAppDevTools(wc),
      },
    ]);
    menu.popup();
  });
}

function createWindow(loadUrl) {
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 960,
    minHeight: 640,
    title: 'Yueli Copilot',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(loadUrl);
  attachWebContentsDebugMenu(mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Yueli Copilot',
        submenu: [
          {
            label: '重新加载界面',
            accelerator: 'CmdOrCtrl+R',
            click: () => mainWindow?.reload(),
          },
          { type: 'separator' },
          {
            label: '打开数据目录',
            click: () => shell.openPath(getApplicationSupportDir()),
          },
          {
            label: '在浏览器打开 Playground',
            click: () => shell.openExternal(`${gatewayBaseUrl.replace(/\/$/, '')}/kgm`),
          },
          { type: 'separator' },
          { role: 'quit', label: '退出 Yueli Copilot' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '调试',
        submenu: [
          {
            label: '显示调试工具栏（地址栏）',
            click: () => {
              mainWindow?.webContents?.executeJavaScript(
                `localStorage.setItem('yueli_debug_enabled','true');localStorage.setItem('yueli_desktop_dev_bar','visible');const u=new URL(location.href);u.searchParams.set('debug','true');location.assign(u.toString());`
              );
            },
          },
          {
            label: '打开开发者工具',
            accelerator: 'Alt+Command+I',
            click: () => openAppDevTools(),
          },
          {
            label: '重载并开启请求日志 (?debug=true)',
            click: () => {
              const wc = mainWindow?.webContents;
              if (!wc || wc.isDestroyed()) return;
              const u = new URL(wc.getURL());
              u.searchParams.set('debug', 'true');
              wc.loadURL(u.toString());
            },
          },
          { type: 'separator' },
          {
            label: '重新加载界面',
            accelerator: 'CmdOrCtrl+R',
            click: () => mainWindow?.reload(),
          },
        ],
      },
      {
        label: '视图',
        submenu: [
          {
            label: '开发者工具',
            accelerator: 'Alt+Command+I',
            click: () => openAppDevTools(),
          },
          { role: 'toggledevtools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ])
  );
}

function createTray() {
  if (process.platform !== 'darwin') return;
  const icon = loadAppIcon();
  if (!icon) return;
  tray = new Tray(icon.resize({ width: 22, height: 22 }));
  tray.setToolTip('Yueli Copilot');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ])
  );
}

function createLoadingWindow() {
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 960,
    minHeight: 640,
    title: 'Yueli Copilot',
    show: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Yueli Copilot</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}
.box{text-align:center}.spin{width:40px;height:40px;border:3px solid #334155;border-top-color:#38bdf8;border-radius:50%;animation:s .8s linear infinite;margin:0 auto 16px}
@keyframes s{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spin"></div><p>正在启动后端服务…</p><p style="opacity:.7;font-size:13px">首次启动可能需要 30–60 秒</p></div></body></html>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  attachWebContentsDebugMenu(mainWindow.webContents);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('yueli:open-devtools', () => openAppDevTools());

async function bootstrap() {
  const useElectronNode = app.isPackaged;

  buildMenu();
  createLoadingWindow();

  try {
    gatewayBaseUrl = await bootBackendWithWatchdog({
      useElectronNode,
      onGatewayRelaunch: (url) => {
        gatewayBaseUrl = url;
        mainWindow?.loadURL(url);
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      'Yueli Copilot 启动失败',
      `${message}\n\n请确认已执行 npm run build:desktop，且本机端口未被占用。`
    );
    app.quit();
    return;
  }

  createTray();
  if (mainWindow) {
    mainWindow.loadURL(gatewayBaseUrl);
    attachWebContentsDebugMenu(mainWindow.webContents);
    mainWindow.show();
  } else {
    createWindow(gatewayBaseUrl);
  }
}

ipcMain.handle('yueli:pick-directory', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths?.length) return null;
  return filePaths[0];
});

ipcMain.handle('yueli:restart-backend', async () => {
  await requestBackendRestart();
  return true;
});

ipcMain.handle('yueli:pick-files', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths?.length) return [];

  const out = [];
  for (const filePath of filePaths) {
    const buf = await fs.promises.readFile(filePath);
    const type = mimeTypeFromPath(filePath);
    out.push({
      name: path.basename(filePath),
      type,
      size: buf.length,
      base64: buf.toString('base64'),
    });
  }
  return out;
});

app.whenReady().then(bootstrap);

app.on('before-quit', () => {
  stopBackendWatchdog();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null && gatewayBaseUrl) {
    createWindow(gatewayBaseUrl);
  } else {
    mainWindow?.show();
  }
});
