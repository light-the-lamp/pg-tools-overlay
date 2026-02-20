import { useEffect, useState } from 'react';
import { PiTreasureChest } from 'react-icons/pi';
import { IoStatsChart } from 'react-icons/io5';
import { HiOutlineChatAlt2 } from 'react-icons/hi';
import { MdOutlineChecklist } from 'react-icons/md';
import { LuExternalLink, LuSwords } from 'react-icons/lu';
import type { ChatNotificationState } from './types';

interface AppReleaseCheckState {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  error: string | null;
}

export default function MenuView(): React.JSX.Element {
  const [chatNotificationState, setChatNotificationState] = useState<ChatNotificationState>({
    keywords: [],
    matchCount: 0
  });
  const [appVersion, setAppVersion] = useState('');
  const [releaseCheck, setReleaseCheck] = useState<AppReleaseCheckState | null>(null);
  const [isCheckingRelease, setIsCheckingRelease] = useState(true);

  const runReleaseCheck = (): void => {
    setIsCheckingRelease(true);
    void window.api
      .checkAppRelease()
      .then((result) => {
        setReleaseCheck(result);
      })
      .finally(() => {
        setIsCheckingRelease(false);
      });
  };

  useEffect(() => {
    void window.api.getChatNotificationState().then(setChatNotificationState);
    void window.api.getAppVersion().then(setAppVersion);
    void window.api
      .checkAppRelease()
      .then((result) => {
        setReleaseCheck(result);
      })
      .finally(() => {
        setIsCheckingRelease(false);
      });
    const unsubscribe = window.api.onChatNotificationStateChanged((state) => {
      setChatNotificationState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const openStats = (): void => {
    void window.api.openStatsWindow();
  };

  const openChatWindow = (): void => {
    void window.api.openChatWindow();
  };

  const openSurveyorWindow = (): void => {
    void window.api.openSurveyorWindow();
  };

  const openLootTrackerWindow = (): void => {
    void window.api.openLootTrackerWindow();
  };

  const openCombatSkillWatcherWindow = (): void => {
    void window.api.openCombatSkillWatcherWindow();
  };

  const openSunValePuzzle = (): void => {
    window.open('https://sun-vale-puzzle.netlify.app/', '_blank', 'noopener,noreferrer');
  };

  return (
    <main className="overlay-shell menu-shell no-drag">
      <p className="menu-title">Menu</p>
      <div className="menu-actions">
        <button className="menu-btn" onClick={openChatWindow} type="button">
          <span className="menu-btn-content">
            <span>New Chat Window</span>
            <span className="menu-btn-icon-wrap">
              <HiOutlineChatAlt2 className="menu-btn-icon" />
              {chatNotificationState.matchCount > 0 ? (
                <span className="menu-alert-badge">{chatNotificationState.matchCount}</span>
              ) : null}
            </span>
          </span>
        </button>
        <button className="menu-btn" onClick={openStats} type="button">
          <span className="menu-btn-content">
            <span>Stats</span>
            <IoStatsChart className="menu-btn-icon" />
          </span>
        </button>
        <button className="menu-btn" onClick={openSurveyorWindow} type="button">
          <span className="menu-btn-content">
            <span>Surveyor</span>
            <PiTreasureChest className="menu-btn-icon" />
          </span>
        </button>
        <button className="menu-btn" onClick={openLootTrackerWindow} type="button">
          <span className="menu-btn-content">
            <span>Loot Tracker</span>
            <MdOutlineChecklist className="menu-btn-icon" />
          </span>
        </button>
        <button className="menu-btn" onClick={openCombatSkillWatcherWindow} type="button">
          <span className="menu-btn-content">
            <span>Combat Skill Watcher</span>
            <LuSwords className="menu-btn-icon" />
          </span>
        </button>
        <button className="menu-btn secondary" onClick={openSunValePuzzle} type="button">
          <span className="menu-btn-content">
            <span>Sun Vale Puzzle</span>
            <LuExternalLink className="menu-btn-icon" />
          </span>
        </button>
      </div>
      <p className="menu-footer">
        More tools coming soon. (maybe)
        {appVersion ? ` v${appVersion}` : ''}
      </p>
      <div className="menu-update-status">
        {isCheckingRelease ? <span>Checking for updates...</span> : null}
        {!isCheckingRelease && releaseCheck?.error ? (
          <span className="menu-update-error">Update check failed: {releaseCheck.error}</span>
        ) : null}
        {!isCheckingRelease && !releaseCheck?.error && releaseCheck?.updateAvailable ? (
          <span>
            Update available: v{releaseCheck.latestVersion}{' '}
            {releaseCheck.releaseUrl ? (
              <a href={releaseCheck.releaseUrl} rel="noreferrer" target="_blank">
                open release
              </a>
            ) : null}
          </span>
        ) : null}
        {!isCheckingRelease &&
        !releaseCheck?.error &&
        releaseCheck &&
        !releaseCheck.updateAvailable &&
        releaseCheck.latestVersion ? (
          <span>Up to date (latest: v{releaseCheck.latestVersion})</span>
        ) : null}
        <button className="menu-update-check-btn" onClick={runReleaseCheck} type="button">
          Check updates
        </button>
      </div>
    </main>
  );
}
