import { ElectronAPI } from '@electron-toolkit/preload'

interface ChatLine {
  id: number
  channel: string | null
  text: string
  matchCount: number
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

interface SurveyorGridSettings {
  thickness: number
  color: string
  gap: number
  columns: number
  size: number
}

interface StatsEntry {
  skill: string
  value: number
}

interface StatsState {
  xpGains: StatsEntry[]
  levelUps: StatsEntry[]
}

interface ChatNotificationState {
  keywords: string[]
  matchCount: number
}

interface LootObjective {
  itemName: string
  count: number
  target: number
}

interface LootObjectiveConfig {
  itemName: string
  target: number
}

interface LootTrackerState {
  objectives: LootObjective[]
}

interface CombatSkillWatcherState {
  selectedSkills: string[]
}

interface AppReleaseCheckState {
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  updateAvailable: boolean
  error: string | null
}

type SurveyDirectionX = 'east' | 'west'
type SurveyDirectionY = 'north' | 'south'
type SurveyMarkerType = 'pin-p' | 'pin-t'

interface SurveyMarker {
  id: number
  type: SurveyMarkerType
  xPercent: number
  yPercent: number
}

interface SurveyClue {
  id: number
  xMeters: number
  xDirection: SurveyDirectionX
  yMeters: number
  yDirection: SurveyDirectionY
  linkedTargetMarkerId: number | null
}

interface SurveyorState {
  started: boolean
  clues: SurveyClue[]
  markers: SurveyMarker[]
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
  openSurveyorWindow2: () => Promise<void>
  getAppVersion: () => Promise<string>
  checkAppRelease: () => Promise<AppReleaseCheckState>
  openChatWindow: () => Promise<void>
  openCombatSkillWatcherWindow: () => Promise<void>
  toggleMenuWindow: () => Promise<void>
  getOverlayOpacity: () => Promise<number>
  setOverlayOpacity: (opacity: number) => Promise<number>
  getFontSettings: () => Promise<FontSettings>
  setFontSettings: (settings: FontSettings) => Promise<FontSettings>
  getStatsState: () => Promise<StatsState>
  getChatState: () => Promise<ChatState>
  getChatNotificationState: () => Promise<ChatNotificationState>
  setChatNotificationKeywords: (keywords: string[]) => Promise<ChatNotificationState>
  markChatNotificationsSeen: () => Promise<ChatNotificationState>
  openLootTrackerWindow: () => Promise<void>
  getLootTrackerState: () => Promise<LootTrackerState>
  setLootTrackerObjectives: (objectives: LootObjectiveConfig[]) => Promise<LootTrackerState>
  setLootTrackerObjectiveCount: (itemName: string, count: number) => Promise<LootTrackerState>
  getCombatSkillWatcherState: () => Promise<CombatSkillWatcherState>
  setCombatSkillWatcherSkills: (skills: string[]) => Promise<CombatSkillWatcherState>
  getSurveyorState: () => Promise<SurveyorState>
  getSurveyorGridSettings: () => Promise<SurveyorGridSettings>
  setSurveyorGridSettings: (settings: SurveyorGridSettings) => Promise<SurveyorGridSettings>
  addSurveyorMarker: (
    type: SurveyMarkerType,
    xPercent: number,
    yPercent: number
  ) => Promise<SurveyorState>
  removeSurveyorMarker: (markerId: number) => Promise<SurveyorState>
  startSurveyor: () => Promise<SurveyorState>
  resetSurveyor: () => Promise<SurveyorState>
  onOverlayLockStateChanged: (listener: (locked: boolean) => void) => () => void
  onOverlayOpacityChanged: (listener: (opacity: number) => void) => () => void
  onFontSettingsChanged: (listener: (settings: FontSettings) => void) => () => void
  onStatsStateChanged: (listener: (state: StatsState) => void) => () => void
  onChatStateChanged: (listener: (state: ChatState) => void) => () => void
  onChatNotificationStateChanged: (listener: (state: ChatNotificationState) => void) => () => void
  onLootTrackerStateChanged: (listener: (state: LootTrackerState) => void) => () => void
  onCombatSkillWatcherStateChanged: (listener: (state: CombatSkillWatcherState) => void) => () => void
  onSurveyorStateChanged: (listener: (state: SurveyorState) => void) => () => void
  onSurveyorGridSettingsChanged: (listener: (settings: SurveyorGridSettings) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: OverlayAPI
  }
}
