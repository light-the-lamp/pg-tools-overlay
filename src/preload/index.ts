import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

interface ChatLine {
  id: number
  channel: string | null
  text: string
}

const api = {
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  resizeWindow: (bounds: {
    width?: number
    height?: number
    x?: number
    y?: number
  }): Promise<void> => {
    return ipcRenderer.invoke('window:resize', bounds)
  },
  getOverlayLocked: (): Promise<boolean> => ipcRenderer.invoke('overlay:get-locked'),
  setOverlayLocked: (locked: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('overlay:set-locked', locked)
  },
  setTopBarInteractive: (interactive: boolean): Promise<void> => {
    return ipcRenderer.invoke('overlay:set-topbar-interactive', interactive)
  },
  openSettingsWindow: (): Promise<void> => {
    return ipcRenderer.invoke('window:open-settings')
  },
  getOverlayOpacity: (): Promise<number> => {
    return ipcRenderer.invoke('overlay:get-opacity')
  },
  setOverlayOpacity: (opacity: number): Promise<number> => {
    return ipcRenderer.invoke('overlay:set-opacity', opacity)
  },
  getChatState: (): Promise<{ logPath: string; channels: string[]; lines: ChatLine[] }> => {
    return ipcRenderer.invoke('chat:get-state')
  },
  onOverlayLockStateChanged: (listener: (locked: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, locked: boolean): void => listener(locked)
    ipcRenderer.on('overlay:lock-state-changed', handler)
    return (): void => {
      ipcRenderer.removeListener('overlay:lock-state-changed', handler)
    }
  },
  onOverlayOpacityChanged: (listener: (opacity: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, opacity: number): void => listener(opacity)
    ipcRenderer.on('overlay:opacity-changed', handler)
    return (): void => {
      ipcRenderer.removeListener('overlay:opacity-changed', handler)
    }
  },
  onChatStateChanged: (
    listener: (state: { logPath: string; channels: string[]; lines: ChatLine[] }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: { logPath: string; channels: string[]; lines: ChatLine[] }
    ): void => listener(state)
    ipcRenderer.on('chat:state-changed', handler)
    return (): void => {
      ipcRenderer.removeListener('chat:state-changed', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
