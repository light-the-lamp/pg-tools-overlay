import { useEffect, useState } from 'react';
import { PiTreasureChest } from 'react-icons/pi';
import { IoStatsChart } from 'react-icons/io5';
import { HiOutlineChatAlt2 } from 'react-icons/hi';
import { MdOutlineChecklist } from 'react-icons/md';
import type { ChatNotificationState } from './types';

export default function MenuView(): React.JSX.Element {
  const [chatNotificationState, setChatNotificationState] = useState<ChatNotificationState>({
    keywords: [],
    matchCount: 0
  });

  useEffect(() => {
    void window.api.getChatNotificationState().then(setChatNotificationState);
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
      </div>
      <p className="menu-footer">More tools coming soon.</p>
    </main>
  );
}
