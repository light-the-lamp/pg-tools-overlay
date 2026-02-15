import { app, shell, BrowserWindow, ipcMain, globalShortcut, screen } from 'electron';
import { existsSync } from 'fs';
import { open, stat, readFile, writeFile } from 'fs/promises';
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

interface FontSettings {
  size: number;
  color: string;
}

interface AppSettings {
  overlayOpacity: number;
  fontSettings: FontSettings;
}

interface StatsEntry {
  skill: string;
  value: number;
}

interface StatsState {
  xpGains: StatsEntry[];
  levelUps: StatsEntry[];
}
const overlayWindows = new Set<BrowserWindow>();
const menuWindows = new Map<BrowserWindow, BrowserWindow>();
let settingsWindow: BrowserWindow | null = null;
let statsWindow: BrowserWindow | null = null;
let overlayLocked = false;
let overlayOpacity = 1;
let overlayFontSettings: FontSettings = { size: 12, color: '#eef3ff' };
let settingsPath = '';
let settingsWriteInFlight: Promise<void> | null = null;
const xpBySkill = new Map<string, number>();
const levelUpsBySkill = new Map<string, number>();
const topBarInteractiveByWindow = new WeakMap<BrowserWindow, boolean>();
const overlayMinSize = { width: 100, height: 100 };
const menuWindowSize = { width: 240, height: 320 };
const menuWindowGap = 8;
const overlayTopBarHeight = 52;
const overlayResizeEdge = 14;
const mouseTrackingIntervalMs = 80;
let mouseTrackingInterval: NodeJS.Timeout | null = null;
const ignoreMouseByWindow = new WeakMap<BrowserWindow, boolean>();

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

function stripLeadingDate(line: string): string {
  const trimmed = line.trimStart();
  const patterns = [
    /^\d{4}[-/]\d{2}[-/]\d{2}\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\s+/i,
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\s+/i
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return trimmed.replace(pattern, `${match[1]} `);
    }
  }

  return trimmed;
}

function parseChatLine(line: string): ChatLine {
  const normalized = stripLeadingDate(line);
  const channelMatch = normalized.match(/\[([^\]]+)\]/);
  const channel = channelMatch ? channelMatch[1].trim() : null;
  return {
    id: ++chatLineId,
    channel,
    text: normalized
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
  for (const window of overlayWindows) {
    window.webContents.send('chat:state-changed', state);
  }
}

function broadcastFontSettings(): void {
  for (const window of overlayWindows) {
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  }
  for (const menuWindow of menuWindows.values()) {
    if (!menuWindow.isDestroyed()) {
      menuWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    }
  }
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  }
  settingsWindow?.webContents.send('overlay:font-settings-changed', overlayFontSettings);
}

function getStatsState(): StatsState {
  const xpGains = Array.from(xpBySkill.entries())
    .map(([skill, value]) => ({ skill, value }))
    .sort((a, b) => b.value - a.value || a.skill.localeCompare(b.skill));
  const levelUps = Array.from(levelUpsBySkill.entries())
    .map(([skill, value]) => ({ skill, value }))
    .sort((a, b) => b.value - a.value || a.skill.localeCompare(b.skill));
  return { xpGains, levelUps };
}

function broadcastStats(): void {
  const state = getStatsState();
  for (const window of overlayWindows) {
    window.webContents.send('stats:state-changed', state);
  }
  for (const menuWindow of menuWindows.values()) {
    if (!menuWindow.isDestroyed()) {
      menuWindow.webContents.send('stats:state-changed', state);
    }
  }
  statsWindow?.webContents.send('stats:state-changed', state);
  settingsWindow?.webContents.send('stats:state-changed', state);
}

function getSettingsPayload(): AppSettings {
  return {
    overlayOpacity,
    fontSettings: overlayFontSettings
  };
}

async function loadAppSettings(): Promise<void> {
  settingsPath = join(app.getPath('userData'), 'settings.json');
  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const nextOpacity =
      typeof parsed.overlayOpacity === 'number'
        ? Math.max(0.2, Math.min(1, parsed.overlayOpacity))
        : overlayOpacity;
    const nextFont = parsed.fontSettings;
    const nextFontSize =
      typeof nextFont?.size === 'number'
        ? Math.max(10, Math.min(22, nextFont.size))
        : overlayFontSettings.size;
    const nextFontColor =
      typeof nextFont?.color === 'string' && nextFont.color.trim()
        ? nextFont.color.trim()
        : overlayFontSettings.color;

    overlayOpacity = nextOpacity;
    overlayFontSettings = { size: nextFontSize, color: nextFontColor };
  } catch {
    // No settings yet or invalid JSON; keep defaults
  }
}

async function persistAppSettings(): Promise<void> {
  if (!settingsPath) return;
  const payload = JSON.stringify(getSettingsPayload(), null, 2);
  const writePromise = writeFile(settingsPath, payload, 'utf8');
  settingsWriteInFlight = writePromise;
  try {
    await writePromise;
  } catch {
    // Ignore write failures
  } finally {
    if (settingsWriteInFlight === writePromise) {
      settingsWriteInFlight = null;
    }
  }
}

function clearChatState(): void {
  chatLines.length = 0;
  chatChannels.clear();
  chatPartialLine = '';
  chatLineId = 0;
  xpBySkill.clear();
  levelUpsBySkill.clear();
}

function trackStatsForLine(line: string): boolean {
  const xpMatch = line.match(/\[Status] You earned (\d+)\s*XP\b/i);
  const skillMatch = line.match(/ in ([^.!]+?)(?:[.!]|$)/i);
  const levelUpMatch = line.match(/reached level \d+\s+in ([^.!]+?)(?:[.!]|$)/i);
  let changed = false;

  if (xpMatch && skillMatch) {
    const gained = Number(xpMatch[1]);
    const skill = skillMatch[1].trim();
    if (Number.isFinite(gained) && skill) {
      xpBySkill.set(skill, (xpBySkill.get(skill) ?? 0) + gained);
      changed = true;
    }
  }

  if (xpMatch && levelUpMatch) {
    const skill = levelUpMatch[1].trim();
    if (skill) {
      levelUpsBySkill.set(skill, (levelUpsBySkill.get(skill) ?? 0) + 1);
      changed = true;
    }
  }

  return changed;
}

function ingestChatLines(lines: string[]): boolean {
  let changed = false;
  let statsChanged = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const parsed = parseChatLine(line);
    statsChanged = trackStatsForLine(parsed.text) || statsChanged;
    if (parsed.channel) {
      chatChannels.add(parsed.channel);
    }
    chatLines.push(parsed);
    changed = true;
  }

  if (chatLines.length > maxChatLines) {
    chatLines.splice(0, chatLines.length - maxChatLines);
  }

  if (statsChanged) {
    broadcastStats();
  }

  return changed || statsChanged;
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

function setIgnoreMouse(window: BrowserWindow, shouldIgnoreMouse: boolean): void {
  const current = ignoreMouseByWindow.get(window);
  if (current === shouldIgnoreMouse) return;
  window.setIgnoreMouseEvents(shouldIgnoreMouse, { forward: true });
  ignoreMouseByWindow.set(window, shouldIgnoreMouse);
}

function shouldAllowMouse(window: BrowserWindow): boolean {
  const { x, y } = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  if (x < bounds.x || x > bounds.x + bounds.width) return false;
  if (y < bounds.y || y > bounds.y + bounds.height) return false;

  const withinTopBar = y <= bounds.y + overlayTopBarHeight;
  const withinResizeEdge =
    x >= bounds.x + bounds.width - overlayResizeEdge ||
    y >= bounds.y + bounds.height - overlayResizeEdge;

  return withinTopBar || withinResizeEdge;
}

function syncMousePassthrough(window: BrowserWindow): void {
  if (!overlayLocked) {
    setIgnoreMouse(window, false);
    return;
  }

  const allowMouse = shouldAllowMouse(window);
  setIgnoreMouse(window, !allowMouse);
}

function getOverlayLikeWindows(): BrowserWindow[] {
  const windows = Array.from(overlayWindows);
  if (statsWindow && !statsWindow.isDestroyed()) {
    windows.push(statsWindow);
  }
  return windows;
}

function applyOverlayLock(locked: boolean): void {
  overlayLocked = locked;
  for (const overlayWindow of getOverlayLikeWindows()) {
    syncMousePassthrough(overlayWindow);
    overlayWindow.webContents.send('overlay:lock-state-changed', overlayLocked);
  }

  if (overlayLocked) {
    if (!mouseTrackingInterval) {
      mouseTrackingInterval = setInterval(() => {
        for (const overlayWindow of getOverlayLikeWindows()) {
          syncMousePassthrough(overlayWindow);
        }
      }, mouseTrackingIntervalMs);
    }
  } else if (mouseTrackingInterval) {
    clearInterval(mouseTrackingInterval);
    mouseTrackingInterval = null;
  }
}

function positionMenuWindow(overlay: BrowserWindow, menu: BrowserWindow): void {
  if (overlay.isDestroyed() || menu.isDestroyed()) return;
  const overlayBounds = overlay.getBounds();
  const nextX = overlayBounds.x + overlayBounds.width + menuWindowGap;
  const nextY = overlayBounds.y;
  menu.setBounds({
    x: nextX,
    y: nextY,
    width: menuWindowSize.width,
    height: menuWindowSize.height
  });
}

function createMenuWindow(parent: BrowserWindow): BrowserWindow {
  const window = new BrowserWindow({
    width: menuWindowSize.width,
    height: menuWindowSize.height,
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: true,
    parent,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  window.setTitle('pg-tools Menu');
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setOpacity(overlayOpacity);

  window.on('ready-to-show', () => {
    positionMenuWindow(parent, window);
    window.show();
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    window.webContents.send('stats:state-changed', getStatsState());
  });

  window.on('closed', () => {
    const existing = menuWindows.get(parent);
    if (existing === window) {
      menuWindows.delete(parent);
    }
  });

  loadRenderer(window, 'menu');
  menuWindows.set(parent, window);
  return window;
}

function toggleMenuWindow(parent: BrowserWindow): void {
  const existing = menuWindows.get(parent);
  if (!existing || existing.isDestroyed()) {
    const window = createMenuWindow(parent);
    positionMenuWindow(parent, window);
    return;
  }

  if (existing.isVisible()) {
    existing.hide();
    return;
  }

  positionMenuWindow(parent, existing);
  existing.show();
}

function applyOverlayTraits(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setFullScreenable(false);
}

function createOverlayWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 760,
    height: 440,
    minWidth: overlayMinSize.width,
    minHeight: overlayMinSize.height,
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

  applyOverlayTraits(mainWindow);
  mainWindow.setOpacity(overlayOpacity);

  mainWindow.on('ready-to-show', () => {
    applyOverlayTraits(mainWindow);
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
    mainWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    mainWindow.webContents.send('stats:state-changed', getStatsState());
    mainWindow.webContents.send('chat:state-changed', getChatState());
  });
  mainWindow.on('closed', () => {
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow && !menuWindow.isDestroyed()) {
      menuWindow.close();
    }
    menuWindows.delete(mainWindow);
    overlayWindows.delete(mainWindow);
    if (overlayWindows.size === 0 && !statsWindow && mouseTrackingInterval) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });
  mainWindow.on('move', () => {
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow) {
      positionMenuWindow(mainWindow, menuWindow);
    }
  });
  mainWindow.on('resize', () => {
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow) {
      positionMenuWindow(mainWindow, menuWindow);
    }
  });
  mainWindow.on('focus', () => {
    applyOverlayTraits(mainWindow);
  });
  mainWindow.on('minimize', () => {
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow) {
      menuWindow.hide();
    }
  });
  mainWindow.on('restore', () => {
    applyOverlayTraits(mainWindow);
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow) {
      positionMenuWindow(mainWindow, menuWindow);
      menuWindow.show();
    }
  });
  mainWindow.on('show', () => {
    applyOverlayTraits(mainWindow);
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow) {
      positionMenuWindow(mainWindow, menuWindow);
      menuWindow.show();
    }
  });
  mainWindow.on('hide', () => {
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow) {
      menuWindow.hide();
    }
  });
  loadRenderer(mainWindow);

  overlayWindows.add(mainWindow);
  createMenuWindow(mainWindow);
  return mainWindow;
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 320,
    minWidth: 380,
    minHeight: 260,
    resizable: true,
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

function createStatsWindow(): BrowserWindow {
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.focus();
    return statsWindow;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 420,
    minWidth: 360,
    minHeight: 280,
    resizable: true,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  window.setTitle('Stats - pg-tools');
  applyOverlayTraits(window);
  syncMousePassthrough(window);

  window.on('ready-to-show', () => {
    applyOverlayTraits(window);
    window.show();
  });
  window.on('focus', () => {
    applyOverlayTraits(window);
  });
  window.on('restore', () => {
    applyOverlayTraits(window);
  });
  window.on('closed', () => {
    statsWindow = null;
    if (overlayWindows.size === 0 && mouseTrackingInterval) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:lock-state-changed', overlayLocked);
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    window.webContents.send('stats:state-changed', getStatsState());
  });

  loadRenderer(window, 'stats');
  statsWindow = window;
  return window;
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.pgtools');
  await loadAppSettings();

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
      const nextWidth = bounds.width ?? current.width;
      const nextHeight = bounds.height ?? current.height;
      window.setBounds({
        x: bounds.x ?? current.x,
        y: bounds.y ?? current.y,
        width: Math.max(overlayMinSize.width, nextWidth),
        height: Math.max(overlayMinSize.height, nextHeight)
      });
    }
  );

  ipcMain.handle('window:open-settings', () => {
    createSettingsWindow();
  });

  ipcMain.handle('window:open-stats', () => {
    createStatsWindow();
  });

  ipcMain.handle('window:open-chat', () => {
    createOverlayWindow();
  });

  ipcMain.handle('window:toggle-menu', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    toggleMenuWindow(window);
  });

  ipcMain.handle('overlay:get-locked', () => overlayLocked);

  ipcMain.handle('overlay:set-locked', (event, locked: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return overlayLocked;
    for (const overlayWindow of overlayWindows) {
      topBarInteractiveByWindow.set(overlayWindow, false);
    }
    applyOverlayLock(Boolean(locked));
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
    for (const window of overlayWindows) {
      window.setOpacity(nextOpacity);
      window.webContents.send('overlay:opacity-changed', nextOpacity);
    }
    for (const menuWindow of menuWindows.values()) {
      if (!menuWindow.isDestroyed()) {
        menuWindow.setOpacity(nextOpacity);
        menuWindow.webContents.send('overlay:opacity-changed', nextOpacity);
      }
    }
    if (statsWindow && !statsWindow.isDestroyed()) {
      statsWindow.setOpacity(nextOpacity);
      statsWindow.webContents.send('overlay:opacity-changed', nextOpacity);
    }
    settingsWindow?.webContents.send('overlay:opacity-changed', nextOpacity);
    void persistAppSettings();
    return overlayOpacity;
  });

  ipcMain.handle('overlay:get-font-settings', () => overlayFontSettings);

  ipcMain.handle('overlay:set-font-settings', (_event, settings: FontSettings) => {
    const nextSize = Math.max(10, Math.min(22, Number(settings.size) || overlayFontSettings.size));
    const nextColor =
      typeof settings.color === 'string' && settings.color.trim()
        ? settings.color.trim()
        : overlayFontSettings.color;
    overlayFontSettings = { size: nextSize, color: nextColor };
    broadcastFontSettings();
    for (const menuWindow of menuWindows.values()) {
      if (!menuWindow.isDestroyed()) {
        menuWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
      }
    }
    if (statsWindow && !statsWindow.isDestroyed()) {
      statsWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    }
    void persistAppSettings();
    return overlayFontSettings;
  });

  ipcMain.handle('chat:get-state', () => getChatState());
  ipcMain.handle('stats:get-state', () => getStatsState());

  createOverlayWindow();
  void runLogMonitorTick();
  logPollInterval = setInterval(() => {
    void runLogMonitorTick();
  }, 1000);

  const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+L' : 'Control+Shift+L';
  globalShortcut.register(toggleShortcut, () => {
    if (overlayWindows.size === 0) return;
    applyOverlayLock(!overlayLocked);
  });

  app.on('activate', function () {
    if (overlayWindows.size === 0) {
      createOverlayWindow();
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
  if (mouseTrackingInterval) {
    clearInterval(mouseTrackingInterval);
    mouseTrackingInterval = null;
  }
  globalShortcut.unregisterAll();
});
