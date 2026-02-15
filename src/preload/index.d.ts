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

interface FontSettings {
  size: number
  color: string
}

interface StatsEntry {
  skill: string
  value: number
}

interface StatsState {
  xpGains: StatsEntry[]
  levelUps: StatsEntry[]
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
  openStatsWindow: () => Promise<void>
  openSurveyorWindow: () => Promise<void>
  openChatWindow: () => Promise<void>
  toggleMenuWindow: () => Promise<void>
  getOverlayOpacity: () => Promise<number>
  setOverlayOpacity: (opacity: number) => Promise<number>
  getFontSettings: () => Promise<FontSettings>
  setFontSettings: (settings: FontSettings) => Promise<FontSettings>
  getStatsState: () => Promise<StatsState>
  getChatState: () => Promise<ChatState>
  onOverlayLockStateChanged: (listener: (locked: boolean) => void) => () => void
  onOverlayOpacityChanged: (listener: (opacity: number) => void) => () => void
  onFontSettingsChanged: (listener: (settings: FontSettings) => void) => () => void
  onStatsStateChanged: (listener: (state: StatsState) => void) => () => void
  onChatStateChanged: (listener: (state: ChatState) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OverlayAPI
  }
}
