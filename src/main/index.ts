import { app, shell, BrowserWindow, ipcMain, globalShortcut, screen } from 'electron';
import { existsSync } from 'fs';
import { open, stat, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../build/icon.png?asset';

interface ChatLine {
  id: number;
  channel: string | null;
  text: string;
  matchCount: number;
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
  chatNotificationKeywords: string[];
  lootTrackerObjectives: LootObjectiveConfig[];
  lootTrackerCounts: Record<string, number>;
  combatSkillWatcherSkills: string[];
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

interface CombatSkillWatcherState {
  selectedSkills: string[];
}

interface StatsEntry {
  skill: string;
  value: number;
}

interface StatsState {
  xpGains: StatsEntry[];
  levelUps: StatsEntry[];
}

type SurveyDirectionX = 'east' | 'west';
type SurveyDirectionY = 'north' | 'south';
type SurveyMarkerType = 'pin-p' | 'pin-t';

interface SurveyMarker {
  id: number;
  type: SurveyMarkerType;
  xPercent: number;
  yPercent: number;
}

interface SurveyClue {
  id: number;
  xMeters: number;
  xDirection: SurveyDirectionX;
  yMeters: number;
  yDirection: SurveyDirectionY;
  linkedTargetMarkerId: number | null;
}

interface SurveyorState {
  started: boolean;
  clues: SurveyClue[];
  markers: SurveyMarker[];
}
const overlayWindows = new Set<BrowserWindow>();
const menuWindows = new Map<BrowserWindow, BrowserWindow>();
let settingsWindow: BrowserWindow | null = null;
let statsWindow: BrowserWindow | null = null;
let surveyorWindow: BrowserWindow | null = null;
let surveyorWindow2: BrowserWindow | null = null;
let lootTrackerWindow: BrowserWindow | null = null;
let combatSkillWatcherWindow: BrowserWindow | null = null;
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
const overlayLockedByWindow = new WeakMap<BrowserWindow, boolean>();

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
let chatNotificationKeywords: string[] = [];
let chatNotificationMatchCount = 0;
const ignoredNotificationChannels = new Set(['combat', 'emotes']);
let lootTrackerObjectives: LootObjectiveConfig[] = [];
const lootCountsByItem = new Map<string, number>();
let combatSkillWatcherSkills: string[] = [];
let surveyorStarted = false;
let surveyMarkerId = 0;
let surveyClueId = 0;
const surveyMarkers: SurveyMarker[] = [];
const surveyClues: SurveyClue[] = [];

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

function sanitizeNotificationKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of keywords) {
    if (typeof raw !== 'string') {
      continue;
    }
    const next = raw.trim();
    if (!next) {
      continue;
    }

    const key = next.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function sanitizeLootTrackerObjectives(objectives: unknown): LootObjectiveConfig[] {
  if (!Array.isArray(objectives)) {
    return [];
  }

  const normalized: LootObjectiveConfig[] = [];
  const seen = new Set<string>();
  for (const raw of objectives) {
    let itemName = '';
    let target = 1;

    if (typeof raw === 'string') {
      itemName = raw.trim();
    } else if (raw && typeof raw === 'object') {
      const maybeName = (raw as { itemName?: unknown }).itemName;
      const maybeTarget = (raw as { target?: unknown }).target;
      if (typeof maybeName === 'string') {
        itemName = maybeName.trim();
      }
      const parsedTarget = Math.floor(Number(maybeTarget));
      if (Number.isFinite(parsedTarget)) {
        target = Math.max(1, parsedTarget);
      }
    }

    if (!itemName) {
      continue;
    }

    const key = itemName.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ itemName, target });
  }

  return normalized;
}

function sanitizeLootCount(value: unknown): number {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) {
    return 0;
  }

  return Math.max(0, next);
}

function sanitizeCombatSkillWatcherSkills(skills: unknown): string[] {
  if (!Array.isArray(skills)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    if (typeof raw !== 'string') {
      continue;
    }

    const next = raw.trim();
    if (!next) {
      continue;
    }

    const key = next.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function sanitizeLootTrackerCounts(
  rawCounts: unknown,
  objectives: LootObjectiveConfig[]
): Map<string, number> {
  const normalized = new Map<string, number>();
  if (!rawCounts || typeof rawCounts !== 'object') {
    for (const objective of objectives) {
      normalized.set(objective.itemName, 0);
    }
    return normalized;
  }

  const source = rawCounts as Record<string, unknown>;
  for (const objective of objectives) {
    normalized.set(objective.itemName, sanitizeLootCount(source[objective.itemName]));
  }

  return normalized;
}

function getPersistableLootTrackerCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const objective of lootTrackerObjectives) {
    counts[objective.itemName] = lootCountsByItem.get(objective.itemName) ?? 0;
  }

  return counts;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMatchableChatText(text: string): string {
  const withoutTimeAndChannel = text.replace(
    /^\s*(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\s*)?\[[^\]]+\]\s*/i,
    ''
  );
  const withoutSpeaker = withoutTimeAndChannel.replace(/^[^:]{1,40}:\s*/, '');
  return withoutSpeaker || withoutTimeAndChannel || text;
}

function isNotificationIgnoredChannel(channel: string | null): boolean {
  if (!channel) {
    return false;
  }

  return ignoredNotificationChannels.has(channel.trim().toLocaleLowerCase());
}

function countNotificationMatches(text: string, channel: string | null): number {
  if (isNotificationIgnoredChannel(channel)) {
    return 0;
  }

  if (!text || chatNotificationKeywords.length === 0) {
    return 0;
  }

  const lowerText = getMatchableChatText(text).toLocaleLowerCase();
  let matches = 0;
  for (const keyword of chatNotificationKeywords) {
    const pattern = new RegExp(escapeRegex(keyword.toLocaleLowerCase()), 'g');
    const keywordMatches = lowerText.match(pattern);
    if (keywordMatches) {
      matches += keywordMatches.length;
    }
  }

  return matches;
}

function looksLikeLootGainLine(text: string): boolean {
  return /(inventory|you (?:receive|received|get|got|obtain|obtained|acquire|acquired|loot|looted|pick up|picked up))/i.test(
    text
  );
}

function parseLooseQuantity(rawValue: string | undefined): number {
  if (!rawValue) {
    return 1;
  }

  const parsed = Number.parseInt(rawValue.replace(/,/g, '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseLootItemAndQuantity(rawText: string): { itemName: string; quantity: number } | null {
  const cleaned = rawText
    .trim()
    .replace(/^[:\-\s]+/, '')
    .replace(/[.!]+$/, '')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .replace(/^(?:an?|the)\s+/i, '');
  if (!cleaned) {
    return null;
  }

  const quantitySuffixMatch = cleaned.match(/^(.+?)\s+x\s*(\d+)$/i);
  if (quantitySuffixMatch) {
    return {
      itemName: quantitySuffixMatch[1].trim(),
      quantity: parseLooseQuantity(quantitySuffixMatch[2])
    };
  }

  const quantityPrefixMatch = cleaned.match(/^(\d+)\s+(.+)$/);
  if (quantityPrefixMatch) {
    return {
      itemName: quantityPrefixMatch[2].trim(),
      quantity: parseLooseQuantity(quantityPrefixMatch[1])
    };
  }

  return { itemName: cleaned, quantity: 1 };
}

function countLootForObjectiveInLine(text: string, objectiveName: string): number {
  const normalizedText = text
    .replace(/^\s*(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\s*)?/i, '')
    .replace(/^(?:\[[^\]]+\]\s*)+/i, '')
    .replace(/^[^:]{1,40}:\s*/, '')
    .trim();

  if (!looksLikeLootGainLine(normalizedText)) {
    return 0;
  }

  const objectiveLower = objectiveName.toLocaleLowerCase();
  const inventoryMatch = normalizedText.match(/^(.+?)\s+added to (?:your\s+)?inventory[.!]?$/i);
  if (inventoryMatch) {
    const parsedLoot = parseLootItemAndQuantity(inventoryMatch[1]);
    if (!parsedLoot) {
      return 0;
    }

    return parsedLoot.itemName.toLocaleLowerCase() === objectiveLower ? parsedLoot.quantity : 0;
  }

  const receivedMatch = normalizedText.match(
    /^you\s+(?:receive|received|get|got|obtain|obtained|acquire|acquired|loot|looted|pick up|picked up)\s+(.+?)$/i
  );
  if (!receivedMatch) {
    return 0;
  }

  const parsedLoot = parseLootItemAndQuantity(receivedMatch[1]);
  if (!parsedLoot) {
    return 0;
  }

  return parsedLoot.itemName.toLocaleLowerCase() === objectiveLower ? parsedLoot.quantity : 0;
}

function trackLootForLine(text: string): boolean {
  if (lootTrackerObjectives.length === 0) {
    return false;
  }

  let changed = false;
  for (const objective of lootTrackerObjectives) {
    const objectiveName = objective.itemName;
    const gained = countLootForObjectiveInLine(text, objectiveName);
    if (gained <= 0) {
      continue;
    }

    lootCountsByItem.set(objectiveName, (lootCountsByItem.get(objectiveName) ?? 0) + gained);
    changed = true;
  }

  return changed;
}

function getSurveyorState(): SurveyorState {
  return {
    started: surveyorStarted,
    clues: surveyClues,
    markers: surveyMarkers
  };
}

function parseSurveyClueFromLine(text: string): Omit<SurveyClue, 'id' | 'linkedTargetMarkerId'> | null {
  const message = getMatchableChatText(text);
  const match = message.match(
    /is\s+(\d+(?:\.\d+)?)\s*m\s*(east|west)\s+and\s+(\d+(?:\.\d+)?)\s*m\s*(north|south)/i
  );
  if (!match) {
    return null;
  }

  const xMeters = Number(match[1]);
  const xDirection = match[2].toLocaleLowerCase() as SurveyDirectionX;
  const yMeters = Number(match[3]);
  const yDirection = match[4].toLocaleLowerCase() as SurveyDirectionY;
  if (!Number.isFinite(xMeters) || !Number.isFinite(yMeters)) {
    return null;
  }

  return {
    xMeters: Math.max(0, xMeters),
    xDirection,
    yMeters: Math.max(0, yMeters),
    yDirection
  };
}

function getNextUnlinkedSurveyClue(): SurveyClue | null {
  return surveyClues.find((clue) => clue.linkedTargetMarkerId == null) ?? null;
}

function trackSurveyorForLine(text: string): boolean {
  if (surveyorStarted) {
    return false;
  }

  const parsedClue = parseSurveyClueFromLine(text);
  if (!parsedClue) {
    return false;
  }

  surveyClues.push({
    id: ++surveyClueId,
    xMeters: parsedClue.xMeters,
    xDirection: parsedClue.xDirection,
    yMeters: parsedClue.yMeters,
    yDirection: parsedClue.yDirection,
    linkedTargetMarkerId: null
  });
  return true;
}

function removeSurveyClueByLinkedMarker(markerId: number): boolean {
  const index = surveyClues.findIndex((clue) => clue.linkedTargetMarkerId === markerId);
  if (index < 0) {
    return false;
  }

  surveyClues.splice(index, 1);
  if (surveyClues.length === 0) {
    surveyClueId = 0;
    surveyorStarted = false;
  }
  return true;
}

function resetSurveyorState(): void {
  surveyorStarted = false;
  surveyMarkers.length = 0;
  surveyClues.length = 0;
  surveyClueId = 0;
}

function surveyorStateHasNoActiveData(): boolean {
  return surveyMarkers.length === 0 && surveyClues.length === 0;
}

function broadcastSurveyorState(): void {
  const state = getSurveyorState();
  if (surveyorWindow && !surveyorWindow.isDestroyed()) {
    surveyorWindow.webContents.send('surveyor:state-changed', state);
  }
  if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
    surveyorWindow2.webContents.send('surveyor:state-changed', state);
  }
}

function parseChatLine(line: string): ChatLine {
  const normalized = stripLeadingDate(line);
  const channelMatch = normalized.match(/\[([^\]]+)\]/);
  const channel = channelMatch ? channelMatch[1].trim() : null;
  return {
    id: ++chatLineId,
    channel,
    text: normalized,
    matchCount: countNotificationMatches(normalized, channel)
  };
}

function getChatState(): ChatState {
  return {
    logPath: currentLogPath,
    channels: Array.from(chatChannels).sort((a, b) => a.localeCompare(b)),
    lines: chatLines
  };
}

function getChatNotificationState(): ChatNotificationState {
  return {
    keywords: chatNotificationKeywords,
    matchCount: chatNotificationMatchCount
  };
}

function getLootTrackerState(): LootTrackerState {
  return {
    objectives: lootTrackerObjectives.map((objective) => ({
      itemName: objective.itemName,
      count: lootCountsByItem.get(objective.itemName) ?? 0,
      target: objective.target
    }))
  };
}

function getCombatSkillWatcherState(): CombatSkillWatcherState {
  return {
    selectedSkills: combatSkillWatcherSkills
  };
}

function broadcastChatState(): void {
  const state = getChatState();
  for (const window of overlayWindows) {
    window.webContents.send('chat:state-changed', state);
  }
}

function broadcastChatNotificationState(): void {
  const state = getChatNotificationState();
  for (const window of overlayWindows) {
    window.webContents.send('chat:notification-state-changed', state);
  }
  for (const menuWindow of menuWindows.values()) {
    if (!menuWindow.isDestroyed()) {
      menuWindow.webContents.send('chat:notification-state-changed', state);
    }
  }
  settingsWindow?.webContents.send('chat:notification-state-changed', state);
}

function broadcastLootTrackerState(): void {
  const state = getLootTrackerState();
  if (lootTrackerWindow && !lootTrackerWindow.isDestroyed()) {
    lootTrackerWindow.webContents.send('loot-tracker:state-changed', state);
  }
}

function broadcastCombatSkillWatcherState(): void {
  const state = getCombatSkillWatcherState();
  if (combatSkillWatcherWindow && !combatSkillWatcherWindow.isDestroyed()) {
    combatSkillWatcherWindow.webContents.send('combat-skill-watcher:state-changed', state);
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
  if (surveyorWindow && !surveyorWindow.isDestroyed()) {
    surveyorWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  }
  if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
    surveyorWindow2.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  }
  if (lootTrackerWindow && !lootTrackerWindow.isDestroyed()) {
    lootTrackerWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  }
  if (combatSkillWatcherWindow && !combatSkillWatcherWindow.isDestroyed()) {
    combatSkillWatcherWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
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
  combatSkillWatcherWindow?.webContents.send('stats:state-changed', state);
  settingsWindow?.webContents.send('stats:state-changed', state);
}

function getSettingsPayload(): AppSettings {
  return {
    overlayOpacity,
    fontSettings: overlayFontSettings,
    chatNotificationKeywords,
    lootTrackerObjectives,
    lootTrackerCounts: getPersistableLootTrackerCounts(),
    combatSkillWatcherSkills
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
    const nextNotificationKeywords = sanitizeNotificationKeywords(parsed.chatNotificationKeywords);
    const nextLootObjectives = sanitizeLootTrackerObjectives(parsed.lootTrackerObjectives);
    const nextLootCounts = sanitizeLootTrackerCounts(parsed.lootTrackerCounts, nextLootObjectives);
    const nextCombatSkills = sanitizeCombatSkillWatcherSkills(parsed.combatSkillWatcherSkills);

    overlayOpacity = nextOpacity;
    overlayFontSettings = { size: nextFontSize, color: nextFontColor };
    chatNotificationKeywords = nextNotificationKeywords;
    lootTrackerObjectives = nextLootObjectives;
    combatSkillWatcherSkills = nextCombatSkills;
    lootCountsByItem.clear();
    for (const [itemName, count] of nextLootCounts) {
      lootCountsByItem.set(itemName, count);
    }
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
  chatNotificationMatchCount = 0;
  xpBySkill.clear();
  levelUpsBySkill.clear();
}

function parseStatusXpLine(line: string): { skill: string; gained: number } | null {
  const match = line.match(/\[Status]\s+You earned\s+(\d+)\s*XP\s+in\s+([^.!]+?)(?:[.!]|$)/i);
  if (!match) {
    return null;
  }

  const gained = Number(match[1]);
  const skill = match[2].trim();
  if (!Number.isFinite(gained) || gained <= 0 || !skill) {
    return null;
  }

  return { skill, gained };
}

function trackStatsForLine(line: string): boolean {
  const xpStatus = parseStatusXpLine(line);
  const levelUpMatch = line.match(/reached level \d+\s+in ([^.!]+?)(?:[.!]|$)/i);
  let changed = false;

  if (xpStatus) {
    xpBySkill.set(xpStatus.skill, (xpBySkill.get(xpStatus.skill) ?? 0) + xpStatus.gained);
    changed = true;
  }

  if (xpStatus && levelUpMatch) {
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
  let notificationChanged = false;
  let lootChanged = false;
  let surveyChanged = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const parsed = parseChatLine(line);
    statsChanged = trackStatsForLine(parsed.text) || statsChanged;
    lootChanged = trackLootForLine(parsed.text) || lootChanged;
    surveyChanged = trackSurveyorForLine(parsed.text) || surveyChanged;
    if (parsed.channel) {
      chatChannels.add(parsed.channel);
    }
    if (parsed.matchCount > 0) {
      chatNotificationMatchCount += parsed.matchCount;
      notificationChanged = true;
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
  if (notificationChanged) {
    broadcastChatNotificationState();
  }
  if (lootChanged) {
    broadcastLootTrackerState();
    void persistAppSettings();
  }
  if (surveyChanged) {
    broadcastSurveyorState();
  }

  return changed || statsChanged || notificationChanged || lootChanged || surveyChanged;
}

function recomputeNotificationMatches(): void {
  let nextMatchCount = 0;
  for (const line of chatLines) {
    line.matchCount = countNotificationMatches(line.text, line.channel);
    nextMatchCount += line.matchCount;
  }
  chatNotificationMatchCount = nextMatchCount;
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
    broadcastChatNotificationState();
    broadcastLootTrackerState();
    return;
  }

  const fileStat = await stat(path);
  currentLogOffset = fileStat.size;
  broadcastChatState();
  broadcastChatNotificationState();
  broadcastLootTrackerState();
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

function isOverlayWindowLocked(window: BrowserWindow): boolean {
  return overlayLockedByWindow.get(window) ?? false;
}

function hasAnyLockedOverlayWindows(): boolean {
  return getOverlayLikeWindows().some((window) => isOverlayWindowLocked(window));
}

function refreshMouseTrackingInterval(): void {
  if (hasAnyLockedOverlayWindows()) {
    if (!mouseTrackingInterval) {
      mouseTrackingInterval = setInterval(() => {
        for (const overlayWindow of getOverlayLikeWindows()) {
          syncMousePassthrough(overlayWindow);
        }
      }, mouseTrackingIntervalMs);
    }
    return;
  }

  if (mouseTrackingInterval) {
    clearInterval(mouseTrackingInterval);
    mouseTrackingInterval = null;
  }
}

function syncMousePassthrough(window: BrowserWindow): void {
  if (!isOverlayWindowLocked(window)) {
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
  if (surveyorWindow && !surveyorWindow.isDestroyed()) {
    windows.push(surveyorWindow);
  }
  if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
    windows.push(surveyorWindow2);
  }
  if (lootTrackerWindow && !lootTrackerWindow.isDestroyed()) {
    windows.push(lootTrackerWindow);
  }
  if (combatSkillWatcherWindow && !combatSkillWatcherWindow.isDestroyed()) {
    windows.push(combatSkillWatcherWindow);
  }
  return windows;
}

function applyOverlayLock(window: BrowserWindow, locked: boolean): void {
  overlayLockedByWindow.set(window, locked);
  syncMousePassthrough(window);
  window.webContents.send('overlay:lock-state-changed', locked);
  refreshMouseTrackingInterval();
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

function positionSurveyorPair(primary: BrowserWindow, secondary: BrowserWindow): void {
  if (primary.isDestroyed() || secondary.isDestroyed()) return;

  const gap = 12;
  const primaryBounds = primary.getBounds();
  const secondaryBounds = secondary.getBounds();
  const cursorPoint = screen.getCursorScreenPoint();
  const workArea = screen.getDisplayNearestPoint(cursorPoint).workArea;
  const totalWidth = primaryBounds.width + gap + secondaryBounds.width;
  const maxHeight = Math.max(primaryBounds.height, secondaryBounds.height);
  const maxStartX = workArea.x + Math.max(0, workArea.width - totalWidth);
  const maxStartY = workArea.y + Math.max(0, workArea.height - maxHeight);
  const startX = Math.min(
    Math.max(workArea.x + Math.floor((workArea.width - totalWidth) / 2), workArea.x),
    maxStartX
  );
  const startY = Math.min(
    Math.max(workArea.y + Math.floor((workArea.height - maxHeight) / 2), workArea.y),
    maxStartY
  );

  primary.setBounds({
    ...primaryBounds,
    x: startX,
    y: startY
  });

  secondary.setBounds({
    ...secondaryBounds,
    x: startX + primaryBounds.width + gap,
    y: startY
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
    window.webContents.send('chat:notification-state-changed', getChatNotificationState());
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
    mainWindow.webContents.send('overlay:lock-state-changed', isOverlayWindowLocked(mainWindow));
    mainWindow.webContents.send('overlay:opacity-changed', overlayOpacity);
    mainWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    mainWindow.webContents.send('stats:state-changed', getStatsState());
    mainWindow.webContents.send('chat:state-changed', getChatState());
    mainWindow.webContents.send('chat:notification-state-changed', getChatNotificationState());
  });
  mainWindow.on('closed', () => {
    overlayLockedByWindow.set(mainWindow, false);
    refreshMouseTrackingInterval();
    const menuWindow = menuWindows.get(mainWindow);
    if (menuWindow && !menuWindow.isDestroyed()) {
      menuWindow.close();
    }
    menuWindows.delete(mainWindow);
    overlayWindows.delete(mainWindow);
    if (
      overlayWindows.size === 0 &&
      !statsWindow &&
      !surveyorWindow &&
      !surveyorWindow2 &&
      !lootTrackerWindow &&
      !combatSkillWatcherWindow &&
      mouseTrackingInterval
    ) {
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
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('chat:notification-state-changed', getChatNotificationState());
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
    overlayLockedByWindow.set(window, false);
    refreshMouseTrackingInterval();
    if (
      overlayWindows.size === 0 &&
      !surveyorWindow &&
      !surveyorWindow2 &&
      !lootTrackerWindow &&
      !combatSkillWatcherWindow &&
      mouseTrackingInterval
    ) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:lock-state-changed', isOverlayWindowLocked(window));
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    window.webContents.send('stats:state-changed', getStatsState());
  });

  loadRenderer(window, 'stats');
  statsWindow = window;
  return window;
}

function createSurveyorWindow(): BrowserWindow {
  if (surveyorWindow && !surveyorWindow.isDestroyed()) {
    surveyorWindow.focus();
    return surveyorWindow;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 320,
    minWidth: 320,
    minHeight: 220,
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

  window.setTitle('Surveyor -> Map - pg-tools');
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
    surveyorWindow = null;
    if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
      surveyorWindow2.close();
    }
    overlayLockedByWindow.set(window, false);
    refreshMouseTrackingInterval();
    if (
      overlayWindows.size === 0 &&
      !statsWindow &&
      !surveyorWindow2 &&
      !lootTrackerWindow &&
      !combatSkillWatcherWindow &&
      mouseTrackingInterval
    ) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:lock-state-changed', isOverlayWindowLocked(window));
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  });

  loadRenderer(window, 'surveyor');
  surveyorWindow = window;
  return window;
}

function createSurveyorWindow2(): BrowserWindow {
  if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
    surveyorWindow2.focus();
    return surveyorWindow2;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 320,
    minWidth: 320,
    minHeight: 220,
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

  window.setTitle('Surveyor Inventory - pg-tools');
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
    surveyorWindow2 = null;
    overlayLockedByWindow.set(window, false);
    refreshMouseTrackingInterval();
    if (
      overlayWindows.size === 0 &&
      !statsWindow &&
      !surveyorWindow &&
      !lootTrackerWindow &&
      !combatSkillWatcherWindow &&
      mouseTrackingInterval
    ) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:lock-state-changed', isOverlayWindowLocked(window));
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
  });

  loadRenderer(window, 'surveyor-2');
  surveyorWindow2 = window;
  return window;
}

function createLootTrackerWindow(): BrowserWindow {
  if (lootTrackerWindow && !lootTrackerWindow.isDestroyed()) {
    lootTrackerWindow.focus();
    return lootTrackerWindow;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 420,
    minWidth: 340,
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

  window.setTitle('Loot Tracker - pg-tools');
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
    lootTrackerWindow = null;
    overlayLockedByWindow.set(window, false);
    refreshMouseTrackingInterval();
    if (
      overlayWindows.size === 0 &&
      !statsWindow &&
      !surveyorWindow &&
      !surveyorWindow2 &&
      !combatSkillWatcherWindow &&
      mouseTrackingInterval
    ) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:lock-state-changed', isOverlayWindowLocked(window));
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    window.webContents.send('loot-tracker:state-changed', getLootTrackerState());
  });

  loadRenderer(window, 'loot-tracker');
  lootTrackerWindow = window;
  return window;
}

function createCombatSkillWatcherWindow(): BrowserWindow {
  if (combatSkillWatcherWindow && !combatSkillWatcherWindow.isDestroyed()) {
    combatSkillWatcherWindow.focus();
    return combatSkillWatcherWindow;
  }

  const window = new BrowserWindow({
    width: 420,
    height: 460,
    minWidth: 340,
    minHeight: 300,
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

  window.setTitle('Combat Skill Watcher - pg-tools');
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
    combatSkillWatcherWindow = null;
    overlayLockedByWindow.set(window, false);
    refreshMouseTrackingInterval();
    if (
      overlayWindows.size === 0 &&
      !statsWindow &&
      !surveyorWindow &&
      !surveyorWindow2 &&
      !lootTrackerWindow &&
      mouseTrackingInterval
    ) {
      clearInterval(mouseTrackingInterval);
      mouseTrackingInterval = null;
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('overlay:lock-state-changed', isOverlayWindowLocked(window));
    window.webContents.send('overlay:opacity-changed', overlayOpacity);
    window.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    window.webContents.send('stats:state-changed', getStatsState());
    window.webContents.send('combat-skill-watcher:state-changed', getCombatSkillWatcherState());
  });

  loadRenderer(window, 'combat-skill-watcher');
  combatSkillWatcherWindow = window;
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

  ipcMain.handle('window:open-surveyor', () => {
    const primary = createSurveyorWindow();
    const secondary = createSurveyorWindow2();
    positionSurveyorPair(primary, secondary);
  });

  ipcMain.handle('window:open-surveyor-2', () => {
    createSurveyorWindow2();
  });

  ipcMain.handle('window:open-loot-tracker', () => {
    createLootTrackerWindow();
  });

  ipcMain.handle('window:open-combat-skill-watcher', () => {
    createCombatSkillWatcherWindow();
  });

  ipcMain.handle('window:open-chat', () => {
    createOverlayWindow();
  });

  ipcMain.handle('window:toggle-menu', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    toggleMenuWindow(window);
  });

  ipcMain.handle('overlay:get-locked', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    return isOverlayWindowLocked(window);
  });

  ipcMain.handle('overlay:set-locked', (event, locked: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    topBarInteractiveByWindow.set(window, false);
    applyOverlayLock(window, Boolean(locked));
    return isOverlayWindowLocked(window);
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
    if (surveyorWindow && !surveyorWindow.isDestroyed()) {
      surveyorWindow.setOpacity(nextOpacity);
      surveyorWindow.webContents.send('overlay:opacity-changed', nextOpacity);
    }
    if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
      surveyorWindow2.setOpacity(nextOpacity);
      surveyorWindow2.webContents.send('overlay:opacity-changed', nextOpacity);
    }
    if (lootTrackerWindow && !lootTrackerWindow.isDestroyed()) {
      lootTrackerWindow.setOpacity(nextOpacity);
      lootTrackerWindow.webContents.send('overlay:opacity-changed', nextOpacity);
    }
    if (combatSkillWatcherWindow && !combatSkillWatcherWindow.isDestroyed()) {
      combatSkillWatcherWindow.setOpacity(nextOpacity);
      combatSkillWatcherWindow.webContents.send('overlay:opacity-changed', nextOpacity);
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
    if (surveyorWindow && !surveyorWindow.isDestroyed()) {
      surveyorWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    }
    if (surveyorWindow2 && !surveyorWindow2.isDestroyed()) {
      surveyorWindow2.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    }
    if (lootTrackerWindow && !lootTrackerWindow.isDestroyed()) {
      lootTrackerWindow.webContents.send('overlay:font-settings-changed', overlayFontSettings);
    }
    if (combatSkillWatcherWindow && !combatSkillWatcherWindow.isDestroyed()) {
      combatSkillWatcherWindow.webContents.send(
        'overlay:font-settings-changed',
        overlayFontSettings
      );
    }
    void persistAppSettings();
    return overlayFontSettings;
  });

  ipcMain.handle('surveyor:get-state', () => getSurveyorState());
  ipcMain.handle(
    'surveyor:add-marker',
    (_event, payload: { type: SurveyMarkerType; xPercent: number; yPercent: number }) => {
      if (surveyorStarted) {
        return getSurveyorState();
      }

      if (!payload || (payload.type !== 'pin-p' && payload.type !== 'pin-t')) {
        return getSurveyorState();
      }

      const xPercent = Math.max(0, Math.min(100, Number(payload.xPercent)));
      const yPercent = Math.max(0, Math.min(100, Number(payload.yPercent)));
      if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
        return getSurveyorState();
      }

      if (payload.type === 'pin-p') {
        const existingPlayerMarker = surveyMarkers.find((marker) => marker.type === 'pin-p');
        if (existingPlayerMarker) {
          existingPlayerMarker.xPercent = xPercent;
          existingPlayerMarker.yPercent = yPercent;
        } else {
          surveyMarkers.push({
            id: ++surveyMarkerId,
            type: 'pin-p',
            xPercent,
            yPercent
          });
        }
      } else {
        const markerId = ++surveyMarkerId;
        surveyMarkers.push({
          id: markerId,
          type: 'pin-t',
          xPercent,
          yPercent
        });

        const nextUnlinkedClue = getNextUnlinkedSurveyClue();
        if (nextUnlinkedClue) {
          nextUnlinkedClue.linkedTargetMarkerId = markerId;
        }
      }

      broadcastSurveyorState();
      return getSurveyorState();
    }
  );
  ipcMain.handle('surveyor:remove-marker', (_event, markerId: number) => {
    const nextMarkerId = Number(markerId);
    const markerIndex = surveyMarkers.findIndex((marker) => marker.id === nextMarkerId);
    if (markerIndex < 0) {
      return getSurveyorState();
    }

    const [removedMarker] = surveyMarkers.splice(markerIndex, 1);
    if (removedMarker.type === 'pin-t') {
      if (surveyorStarted) {
        const playerMarker = surveyMarkers.find((marker) => marker.type === 'pin-p');
        if (playerMarker) {
          playerMarker.xPercent = removedMarker.xPercent;
          playerMarker.yPercent = removedMarker.yPercent;
        } else {
          surveyMarkers.push({
            id: ++surveyMarkerId,
            type: 'pin-p',
            xPercent: removedMarker.xPercent,
            yPercent: removedMarker.yPercent
          });
        }
      }
      removeSurveyClueByLinkedMarker(removedMarker.id);
    }
    if (surveyorStateHasNoActiveData()) {
      surveyClueId = 0;
      surveyorStarted = false;
    }

    broadcastSurveyorState();
    return getSurveyorState();
  });
  ipcMain.handle('surveyor:start', () => {
    const hasPlayerMarker = surveyMarkers.some((marker) => marker.type === 'pin-p');
    const hasTargetMarker = surveyMarkers.some((marker) => marker.type === 'pin-t');
    if (!hasPlayerMarker || !hasTargetMarker) {
      return getSurveyorState();
    }

    surveyorStarted = true;
    broadcastSurveyorState();
    return getSurveyorState();
  });
  ipcMain.handle('surveyor:reset', () => {
    resetSurveyorState();
    broadcastSurveyorState();
    return getSurveyorState();
  });

  ipcMain.handle('chat:get-state', () => getChatState());
  ipcMain.handle('chat:get-notification-state', () => getChatNotificationState());
  ipcMain.handle('chat:set-notification-keywords', (_event, keywords: unknown) => {
    chatNotificationKeywords = sanitizeNotificationKeywords(keywords);
    recomputeNotificationMatches();
    broadcastChatState();
    broadcastChatNotificationState();
    void persistAppSettings();
    return getChatNotificationState();
  });
  ipcMain.handle('chat:mark-notifications-seen', () => {
    if (chatNotificationMatchCount === 0) {
      return getChatNotificationState();
    }

    chatNotificationMatchCount = 0;
    broadcastChatNotificationState();
    return getChatNotificationState();
  });
  ipcMain.handle('stats:get-state', () => getStatsState());
  ipcMain.handle('loot-tracker:get-state', () => getLootTrackerState());
  ipcMain.handle('loot-tracker:set-objectives', (_event, itemNames: unknown) => {
    const nextObjectives = sanitizeLootTrackerObjectives(itemNames);
    const previousCounts = new Map(lootCountsByItem);
    lootTrackerObjectives = nextObjectives;
    lootCountsByItem.clear();
    for (const objective of lootTrackerObjectives) {
      lootCountsByItem.set(objective.itemName, previousCounts.get(objective.itemName) ?? 0);
    }
    broadcastLootTrackerState();
    void persistAppSettings();
    return getLootTrackerState();
  });
  ipcMain.handle('loot-tracker:set-objective-count', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return getLootTrackerState();
    }

    const maybeItemName = (payload as { itemName?: unknown }).itemName;
    const maybeCount = (payload as { count?: unknown }).count;
    if (typeof maybeItemName !== 'string') {
      return getLootTrackerState();
    }

    const itemName = maybeItemName.trim();
    if (!itemName || !lootTrackerObjectives.some((objective) => objective.itemName === itemName)) {
      return getLootTrackerState();
    }

    lootCountsByItem.set(itemName, sanitizeLootCount(maybeCount));
    broadcastLootTrackerState();
    void persistAppSettings();
    return getLootTrackerState();
  });
  ipcMain.handle('combat-skill-watcher:get-state', () => getCombatSkillWatcherState());
  ipcMain.handle('combat-skill-watcher:set-selected-skills', (_event, skills: unknown) => {
    combatSkillWatcherSkills = sanitizeCombatSkillWatcherSkills(skills);
    broadcastCombatSkillWatcherState();
    void persistAppSettings();
    return getCombatSkillWatcherState();
  });

  createOverlayWindow();
  void runLogMonitorTick();
  logPollInterval = setInterval(() => {
    void runLogMonitorTick();
  }, 1000);

  const toggleShortcut = process.platform === 'darwin' ? 'Command+Shift+L' : 'Control+Shift+L';
  globalShortcut.register(toggleShortcut, () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (!focusedWindow) return;
    if (!getOverlayLikeWindows().includes(focusedWindow)) return;
    applyOverlayLock(focusedWindow, !isOverlayWindowLocked(focusedWindow));
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
