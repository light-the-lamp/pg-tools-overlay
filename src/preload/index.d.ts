import { ElectronAPI } from '@electron-toolkit/preload'

interface ChatLine {
  id: number
  channel: string | null
  text: string
}

interface ChatState {
  logPath: string
  channels: string[]
  lines: ChatLine[]
}

interface OverlayAPI {
  minimizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  resizeWindow: (bounds: {
    width?: number
    height?: number
    x?: number
    y?: number
  }) => Promise<void>
  getOverlayLocked: () => Promise<boolean>
  setOverlayLocked: (locked: boolean) => Promise<boolean>
  setTopBarInteractive: (interactive: boolean) => Promise<void>
  openSettingsWindow: () => Promise<void>
  getOverlayOpacity: () => Promise<number>
  setOverlayOpacity: (opacity: number) => Promise<number>
  getChatState: () => Promise<ChatState>
  onOverlayLockStateChanged: (listener: (locked: boolean) => void) => () => void
  onOverlayOpacityChanged: (listener: (opacity: number) => void) => () => void
  onChatStateChanged: (listener: (state: ChatState) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OverlayAPI
  }
}
