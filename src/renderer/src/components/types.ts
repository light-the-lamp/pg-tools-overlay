export interface ChatLine {
  id: number;
  channel: string | null;
  text: string;
  matchCount: number;
}

export interface ChatState {
  logPath: string;
  channels: string[];
  lines: ChatLine[];
}

export interface FontSettings {
  size: number;
  color: string;
}

export interface StatsEntry {
  skill: string;
  value: number;
}

export interface StatsState {
  xpGains: StatsEntry[];
  levelUps: StatsEntry[];
}

export interface ChatNotificationState {
  keywords: string[];
  matchCount: number;
}

export interface LootObjective {
  itemName: string;
  count: number;
  target: number;
}

export interface LootObjectiveConfig {
  itemName: string;
  target: number;
}

export interface LootTrackerState {
  objectives: LootObjective[];
}

export interface CombatSkillWatcherState {
  selectedSkills: string[];
}
