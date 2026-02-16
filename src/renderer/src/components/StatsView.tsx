import { useCallback, useEffect, useState } from 'react';
import type { FontSettings, StatsState } from './types';

export default function StatsView(): React.JSX.Element {
  const [statsState, setStatsState] = useState<StatsState>({ xpGains: [], levelUps: [] });
  const [isLocked, setIsLocked] = useState(false);
  const [fontSettings, setFontSettings] = useState<FontSettings>({ size: 12, color: '#eef3ff' });

  const startResize = useCallback(
    (direction: 'right' | 'bottom' | 'corner', startEvent: React.MouseEvent) => {
      startEvent.preventDefault();
      const startX = startEvent.screenX;
      const startY = startEvent.screenY;
      const startWidth = window.outerWidth;
      const startHeight = window.outerHeight;

      const onMouseMove = (event: MouseEvent): void => {
        const dx = event.screenX - startX;
        const dy = event.screenY - startY;

        const nextBounds: { width?: number; height?: number } = {};

        if (direction === 'right' || direction === 'corner') {
          nextBounds.width = startWidth + dx;
        }

        if (direction === 'bottom' || direction === 'corner') {
          nextBounds.height = startHeight + dy;
        }

        void window.api.resizeWindow(nextBounds);
      };

      const stopResize = (): void => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', stopResize);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', stopResize);
    },
    []
  );

  useEffect(() => {
    void window.api.getStatsState().then(setStatsState);
    const unsubscribe = window.api.onStatsStateChanged((state) => {
      setStatsState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void window.api.getOverlayLocked().then(setIsLocked);
    const unsubscribe = window.api.onOverlayLockStateChanged((locked) => {
      setIsLocked(locked);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void window.api.getFontSettings().then(setFontSettings);
    const unsubscribe = window.api.onFontSettingsChanged((settings) => {
      setFontSettings(settings);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const openSettings = (): void => {
    void window.api.openSettingsWindow();
  };

  const openChatWindow = (): void => {
    void window.api.openChatWindow();
  };

  const toggleMenuWindow = (): void => {
    void window.api.toggleMenuWindow();
  };

  const toggleLock = (): void => {
    void window.api.setOverlayLocked(!isLocked);
  };

  const minimizeWindow = (): void => {
    void window.api.minimizeWindow();
  };

  const closeWindow = (): void => {
    void window.api.closeWindow();
  };

  return (
    <main className="overlay-shell">
      <header className="drag-bar">
        <p className="title">PG Tools Stats</p>
        <div className="window-actions no-drag">
          <button
            aria-label="Open settings"
            className="window-btn settings"
            onClick={openSettings}
            title="Settings"
            type="button"
          >
            S
          </button>
          <button
            aria-label="Toggle menu window"
            className="window-btn menu"
            onClick={toggleMenuWindow}
            title="Toggle menu"
            type="button"
          >
            M
          </button>
          <button
            aria-label="Open new chat window"
            className="window-btn new-chat"
            onClick={openChatWindow}
            title="New chat window"
            type="button"
          >
            N
          </button>
          <button
            aria-label={isLocked ? 'Unlock overlay' : 'Lock overlay'}
            className="window-btn lock"
            onClick={toggleLock}
            title={isLocked ? 'Unlock overlay' : 'Lock overlay'}
            type="button"
          >
            {isLocked ? 'U' : 'L'}
          </button>
          <button
            aria-label="Minimize"
            className="window-btn"
            onClick={minimizeWindow}
            title="Minimize"
            type="button"
          >
            _
          </button>
          <button
            aria-label="Close"
            className="window-btn close"
            onClick={closeWindow}
            title="Close"
            type="button"
          >
            x
          </button>
        </div>
      </header>
      <div
        className="stats-content"
        style={
          {
            '--chat-font-size': `${fontSettings.size}px`,
            '--chat-font-color': fontSettings.color
          } as React.CSSProperties
        }
      >
        <div className="stats-log">
          <p className="stats-title">XP Gains</p>
          {statsState.xpGains.length === 0 && <p className="stats-empty">No XP gains yet.</p>}
          {statsState.xpGains.map((entry) => (
            <p className="stats-line" key={`xp-${entry.skill}`}>
              {entry.skill} +{entry.value} XP
            </p>
          ))}
          <p className="stats-title">Level Ups</p>
          {statsState.levelUps.length === 0 && <p className="stats-empty">No level ups yet.</p>}
          {statsState.levelUps.map((entry) => (
            <p className="stats-line" key={`lvl-${entry.skill}`}>
              +{entry.value} {entry.skill}
            </p>
          ))}
        </div>
        <p className="status-line file-path">If you need help with this app, talk to Lamplighter</p>
      </div>
      <div
        className="resize-handle resize-right no-drag"
        onMouseDown={(event) => startResize('right', event)}
      />
      <div
        className="resize-handle resize-bottom no-drag"
        onMouseDown={(event) => startResize('bottom', event)}
      />
      <div
        className="resize-handle resize-corner no-drag"
        onMouseDown={(event) => startResize('corner', event)}
      />
    </main>
  );
}
