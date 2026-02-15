import { useEffect, useState } from 'react';

export default function MenuView(): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    void window.api.getOverlayLocked().then(setIsLocked);
    const unsubscribe = window.api.onOverlayLockStateChanged((locked) => {
      setIsLocked(locked);
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

  return (
    <main className="menu-shell no-drag">
      <p className="menu-title">Menu</p>
      <div className="menu-actions">
        <button className="menu-btn" onClick={openChatWindow} type="button">
          New Chat Window
        </button>
        <button className="menu-btn" onClick={openStats} type="button">
          Stats
        </button>
      </div>
      <p className="menu-footer">More tools coming soon.</p>
    </main>
  );
}
