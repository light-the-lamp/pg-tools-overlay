export interface ChatLine {
  id: number;
  channel: string | null;
  text: string;
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
