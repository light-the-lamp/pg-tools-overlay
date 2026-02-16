import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

interface ChatLine {
  id: number;
  channel: string | null;
  text: string;
  matchCount: number;
}

interface FontSettings {
  size: number;
  color: string;
}

interface StatsEntry {
  skill: string;
  value: number;
}

interface StatsState {
  xpGains: StatsEntry[];
  levelUps: StatsEntry[];
}

interface ChatNotificationState {
  keywords: string[];
  matchCount: number;
}

interface LootObjective {
  itemName: string;
  count: number;
  target: number;
}

interface LootObjectiveConfig {
  itemName: string;
  target: number;
}

interface LootTrackerState {
  objectives: LootObjective[];
}

const api = {
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  resizeWindow: (bounds: {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }): Promise<void> => {
    return ipcRenderer.invoke('window:resize', bounds);
  },
  getOverlayLocked: (): Promise<boolean> => ipcRenderer.invoke('overlay:get-locked'),
  setOverlayLocked: (locked: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('overlay:set-locked', locked);
  },
  setTopBarInteractive: (interactive: boolean): Promise<void> => {
    return ipcRenderer.invoke('overlay:set-topbar-interactive', interactive);
  },
  openSettingsWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:open-settings');
  },
  openStatsWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:open-stats');
  },
  openSurveyorWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:open-surveyor');
  },
  openLootTrackerWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:open-loot-tracker');
  },
  openChatWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:open-chat');
  },
  toggleMenuWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:toggle-menu');
  },
  getOverlayOpacity: (): Promise<number> => {
    return ipcRenderer.invoke('overlay:get-opacity');
  },
  setOverlayOpacity: (opacity: number): Promise<number> => {
    return ipcRenderer.invoke('overlay:set-opacity', opacity);
  },
  getFontSettings: (): Promise<FontSettings> => {
    return ipcRenderer.invoke('overlay:get-font-settings');
  },
  setFontSettings: (settings: FontSettings): Promise<FontSettings> => {
    return ipcRenderer.invoke('overlay:set-font-settings', settings);
  },
  getStatsState: (): Promise<StatsState> => {
    return ipcRenderer.invoke('stats:get-state');
  },
  getChatState: (): Promise<{ logPath: string; channels: string[]; lines: ChatLine[] }> => {
    return ipcRenderer.invoke('chat:get-state');
  },
  getChatNotificationState: (): Promise<ChatNotificationState> => {
    return ipcRenderer.invoke('chat:get-notification-state');
  },
  setChatNotificationKeywords: (keywords: string[]): Promise<ChatNotificationState> => {
    return ipcRenderer.invoke('chat:set-notification-keywords', keywords);
  },
  markChatNotificationsSeen: (): Promise<ChatNotificationState> => {
    return ipcRenderer.invoke('chat:mark-notifications-seen');
  },
  getLootTrackerState: (): Promise<LootTrackerState> => {
    return ipcRenderer.invoke('loot-tracker:get-state');
  },
  setLootTrackerObjectives: (objectives: LootObjectiveConfig[]): Promise<LootTrackerState> => {
    return ipcRenderer.invoke('loot-tracker:set-objectives', objectives);
  },
  setLootTrackerObjectiveCount: (itemName: string, count: number): Promise<LootTrackerState> => {
    return ipcRenderer.invoke('loot-tracker:set-objective-count', { itemName, count });
  },
  onOverlayLockStateChanged: (listener: (locked: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, locked: boolean): void => listener(locked);
    ipcRenderer.on('overlay:lock-state-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('overlay:lock-state-changed', handler);
    };
  },
  onOverlayOpacityChanged: (listener: (opacity: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, opacity: number): void => listener(opacity);
    ipcRenderer.on('overlay:opacity-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('overlay:opacity-changed', handler);
    };
  },
  onFontSettingsChanged: (listener: (settings: FontSettings) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: FontSettings): void =>
      listener(settings);
    ipcRenderer.on('overlay:font-settings-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('overlay:font-settings-changed', handler);
    };
  },
  onStatsStateChanged: (listener: (state: StatsState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: StatsState): void => listener(state);
    ipcRenderer.on('stats:state-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('stats:state-changed', handler);
    };
  },
  onChatStateChanged: (
    listener: (state: { logPath: string; channels: string[]; lines: ChatLine[] }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: { logPath: string; channels: string[]; lines: ChatLine[] }
    ): void => listener(state);
    ipcRenderer.on('chat:state-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('chat:state-changed', handler);
    };
  },
  onChatNotificationStateChanged: (
    listener: (state: ChatNotificationState) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: ChatNotificationState
    ): void => listener(state);
    ipcRenderer.on('chat:notification-state-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('chat:notification-state-changed', handler);
    };
  },
  onLootTrackerStateChanged: (listener: (state: LootTrackerState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LootTrackerState): void =>
      listener(state);
    ipcRenderer.on('loot-tracker:state-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('loot-tracker:state-changed', handler);
    };
  }
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
