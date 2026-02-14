import { app, shell, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import { existsSync } from 'fs';
import { open, stat } from 'fs/promises';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';

interface ChatLine {
  id: number;
  channel: string | null;
  text: string;
}

interface ChatState {
  logPath: string;
  channels: string[];
  lines: ChatLine[];
}

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let overlayLocked = false;
let overlayOpacity = 1;
const topBarInteractiveByWindow = new WeakMap<BrowserWindow, boolean>();

const chatLines: ChatLine[] = [];
const chatChannels = new Set<string>();
let chatLineId = 0;
let chatPartialLine = '';
let currentLogPath = '';
let currentLogDateKey = '';
let currentLogOffset = 0;
let logPollInterval: NodeJS.Timeout | null = null;
let logPollInFlight = false;
const maxChatLines = 600;

function getDateKey(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getTodayLogCandidates(): string[] {
  const homePath = app.getPath('home');
  const dateKey = getDateKey(new Date());
  const baseDir = join(homePath, 'AppData', 'LocalLow', 'Elder Game', 'Project Gorgon', 'ChatLogs');
  const baseName = `Chat-${dateKey}`;
  return [join(baseDir, `${baseName}.log`), join(baseDir, baseName)];
}

function parseChatLine(line: string): ChatLine {
  const channelMatch = line.match(/\[([^\]]+)\]/);
  const channel = channelMatch ? channelMatch[1].trim() : null;
  return {
    id: ++chatLineId,
    channel,
    text: line
  };
}

function getChatState(): ChatState {
  return {
    logPath: currentLogPath,
    channels: Array.from(chatChannels).sort((a, b) => a.localeCompare(b)),
    lines: chatLines
  };
}

function broadcastChatState(): void {
  const state = getChatState();
  overlayWindow?.webContents.send('chat:state-changed', state);
}

function clearChatState(): void {
  chatLines.length = 0;
  chatChannels.clear();
  chatPartialLine = '';
  chatLineId = 0;
}

function ingestChatLines(lines: string[]): boolean {
  let changed = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const parsed = parseChatLine(line);
    if (parsed.channel) {
      chatChannels.add(parsed.channel);
    }
    chatLines.push(parsed);
    changed = true;
  }

  if (chatLines.length > maxChatLines) {
    chatLines.splice(0, chatLines.length - maxChatLines);
  }

  return changed;
}

function consumeChunk(text: string, flushTail: boolean): boolean {
  if (!text && !flushTail) return false;

  const merged = chatPartialLine + text;
  const pieces = merged.split(/\r?\n/);
  chatPartialLine = pieces.pop() ?? '';
  let changed = ingestChatLines(pieces);

  if (flushTail && chatPartialLine.trim()) {
    changed = ingestChatLines([chatPartialLine]) || changed;
    chatPartialLine = '';
  }

  return changed;
}

async function initializeCurrentLogFile(path: string): Promise<void> {
  currentLogPath = path;
  currentLogDateKey = getDateKey(new Date());
  currentLogOffset = 0;
  clearChatState();

  if (!existsSync(path)) {
    broadcastChatState();
    return;
  }

  const fileStat = await stat(path);
  currentLogOffset = fileStat.size;
  broadcastChatState();
}

async function syncLogPathAndDate(): Promise<void> {
  const todayDateKey = getDateKey(new Date());
  const candidates = getTodayLogCandidates();
  const preferredPath = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  const mustSwitch = preferredPath !== currentLogPath || todayDateKey !== currentLogDateKey;

  if (!mustSwitch) return;
  await initializeCurrentLogFile(preferredPath);
}

async function pollLogFile(): Promise<void> {
  if (!currentLogPath || !existsSync(currentLogPath)) {
    return;
  }

  const fileStat = await stat(currentLogPath);
  if (fileStat.size < currentLogOffset) {
    currentLogOffset = 0;
    chatPartialLine = '';
  }

  if (fileStat.size === currentLogOffset) {
    return;
  }

  const bytesToRead = fileStat.size - currentLogOffset;
  const handle = await open(currentLogPath, 'r');
  const buffer = Buffer.alloc(bytesToRead);
  await handle.read(buffer, 0, bytesToRead, currentLogOffset);
  await handle.close();
  currentLogOffset = fileStat.size;

  const changed = consumeChunk(buffer.toString('utf8'), false);
  if (changed) {
    broadcastChatState();
  }
}

async function runLogMonitorTick(): Promise<void> {
  if (logPollInFlight) return;
  logPollInFlight = true;
  try {
    await syncLogPathAndDate();
    await pollLogFile();
  } catch {
    // Ignoring errors, will simply try again
  } finally {
    logPollInFlight = false;
  }
}

function loadRenderer(window: BrowserWindow, hash?: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL']);
    url.hash = hash ?? '';
    window.loadURL(url.toString());
    return;
  }

  window.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
}

function syncMousePassthrough(window: BrowserWindow): void {
  const topBarInteractive = topBarInteractiveByWindow.get(window) ?? false;
  const shouldIgnoreMouse = overlayLocked && !topBarInteractive;
  window.setIgnoreMouseEvents(shouldIgnoreMouse, { forward: true });
}

function applyOverlayLock(window: BrowserWindow, locked: boolean): void {
  overlayLocked = locked;
  syncMousePassthrough(window);
  window.webContents.send('overlay:lock-state-changed', overlayLocked);
}

function createOverlayWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 760,
    height: 440,
    minWidth: 320,
    minHeight: 180,
    resizable: true,
    thickFrame: true,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });
  mainWindow.setTitle('pg-tools Overlay');

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setOpacity(overlayOpacity);

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  topBarInteractiveByWindow.set(mainWindow, false);
  syncMousePassthrough(mainWindow);
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('overlay:lock-state-changed', overlayLocked);
    mainWindow.webContents.send('overlay:opacity-changed', overlayOpacity);
    mainWindow.webContents.send('chat:state-changed', getChatState());
  });
  mainWindow.on('closed', () => {
    overlayWindow = null;
  });
  loadRenderer(mainWindow);

  return mainWindow;
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const window = new BrowserWindow({
    width: 360,
    height: 180,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  window.setTitle('Settings - pg-tools');

  window.on('ready-to-show', () => {
    window.show();
  });
  window.on('closed', () => {
    settingsWindow = null;
  });

  loadRenderer(window, 'settings');
  settingsWindow = window;
  return window;
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pgtools');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  ipcMain.handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
  });

  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
  });

  ipcMain.handle(
    'window:resize',
    (event, bounds: { width?: number; height?: number; x?: number; y?: number }) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;

      const current = window.getBounds();
      window.setBounds({
        x: bounds.x ?? current.x,
        y: bounds.y ?? current.y,
        width: bounds.width ?? current.width,
        height: bounds.height ?? current.height
      });
    }
  );

  ipcMain.handle('window:open-settings', () => {
    createSettingsWindow();
  });

  ipcMain.handle('overlay:get-locked', () => overlayLocked);

  ipcMain.handle('overlay:set-locked', (event, locked: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return overlayLocked;
    topBarInteractiveByWindow.set(window, false);
    applyOverlayLock(window, Boolean(locked));
    return overlayLocked;
  });

  ipcMain.handle('overlay:set-topbar-interactive', (event, interactive: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    topBarInteractiveByWindow.set(window, Boolean(interactive));
    syncMousePassthrough(window);
  });

  ipcMain.handle('overlay:get-opacity', () => overlayOpacity);

  ipcMain.handle('overlay:set-opacity', (_event, value: number) => {
    const nextOpacity = Math.max(0.2, Math.min(1, value));
    overlayOpacity = nextOpacity;
    overlayWindow?.setOpacity(nextOpacity);
    overlayWindow?.webContents.send('overlay:opacity-changed', nextOpacity);
    settingsWindow?.webContents.send('overlay:opacity-changed', nextOpacity);
    return overlayOpacity;
  });

  ipcMain.handle('chat:get-state', () => getChatState());

  overlayWindow = createOverlayWindow();
  void runLogMonitorTick();
  logPollInterval = setInterval(() => {
    void runLogMonitorTick();
  }, 1000);

  const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+L' : 'Control+Shift+L';
  globalShortcut.register(toggleShortcut, () => {
    if (!overlayWindow) return;
    applyOverlayLock(overlayWindow, !overlayLocked);
  });

  app.on('activate', function () {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (logPollInterval) {
    clearInterval(logPollInterval);
    logPollInterval = null;
  }
  globalShortcut.unregisterAll();
});
