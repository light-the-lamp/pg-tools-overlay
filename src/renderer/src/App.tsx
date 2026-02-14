import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ResizeDirection = 'right' | 'bottom' | 'corner';

interface ChatLine {
  id: number;
  channel: string | null;
  text: string;
}

interface ChatState {
  logPath: string;
  channels: string[];
  lines: ChatLine[];
}

function OverlayView(): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(false);
  const [chatState, setChatState] = useState<ChatState>({ logPath: '', channels: [], lines: [] });
  const [selectedChannel, setSelectedChannel] = useState('All');
  const overlayShellRef = useRef<HTMLElement | null>(null);
  const dragBarRef = useRef<HTMLElement | null>(null);
  const logListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const minimizeWindow = (): void => {
    void window.api.minimizeWindow();
  };

  const closeWindow = (): void => {
    void window.api.closeWindow();
  };

  const toggleLock = (): void => {
    void window.api.setOverlayLocked(!isLocked);
  };

  const openSettings = (): void => {
    void window.api.openSettingsWindow();
  };

  const startResize = useCallback((direction: ResizeDirection) => {
    const startX = window.screenX;
    const startY = window.screenY;
    const startWidth = window.outerWidth;
    const startHeight = window.outerHeight;

    const onMouseMove = (event: MouseEvent): void => {
      const dx = event.screenX - startX;
      const dy = event.screenY - startY;

      const nextBounds: { width?: number; height?: number } = {};

      if (direction === 'right' || direction === 'corner') {
        nextBounds.width = Math.max(320, startWidth + dx);
      }

      if (direction === 'bottom' || direction === 'corner') {
        nextBounds.height = Math.max(180, startHeight + dy);
      }

      void window.api.resizeWindow(nextBounds);
    };

    const stopResize = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
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
    void window.api.getChatState().then((state) => {
      setChatState(state);
    });

    const unsubscribe = window.api.onChatStateChanged((state) => {
      setChatState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const logList = logListRef.current;
    if (!logList || !stickToBottomRef.current) return;
    logList.scrollTop = logList.scrollHeight;
  }, [chatState.lines, selectedChannel]);

  useEffect(() => {
    let topBarInteractive = false;

    const setTopBarInteractive = (interactive: boolean): void => {
      if (topBarInteractive === interactive) return;
      topBarInteractive = interactive;
      void window.api.setTopBarInteractive(interactive);
    };

    const updateTopBarHover = (event: MouseEvent): void => {
      if (!isLocked) {
        setTopBarInteractive(false);
        return;
      }

      const dragBar = dragBarRef.current;
      const overlayShell = overlayShellRef.current;
      if (!dragBar || !overlayShell) return;

      const dragBarRect = dragBar.getBoundingClientRect();
      const shellRect = overlayShell.getBoundingClientRect();
      const isOverTopBar =
        event.clientX >= dragBarRect.left &&
        event.clientX <= dragBarRect.right &&
        event.clientY >= dragBarRect.top &&
        event.clientY <= dragBarRect.bottom;

      const edgeSize = 14;
      const isOverResizeZone =
        (event.clientY >= shellRect.bottom - edgeSize &&
          event.clientY <= shellRect.bottom &&
          event.clientX >= shellRect.left &&
          event.clientX <= shellRect.right) ||
        (event.clientX >= shellRect.right - edgeSize &&
          event.clientX <= shellRect.right &&
          event.clientY >= shellRect.top &&
          event.clientY <= shellRect.bottom);

      setTopBarInteractive(isOverTopBar || isOverResizeZone);
    };

    const clearTopBarHover = (): void => {
      setTopBarInteractive(false);
    };

    window.addEventListener('mousemove', updateTopBarHover);
    window.addEventListener('mouseleave', clearTopBarHover);

    return () => {
      clearTopBarHover();
      window.removeEventListener('mousemove', updateTopBarHover);
      window.removeEventListener('mouseleave', clearTopBarHover);
    };
  }, [isLocked]);

  const activeChannel =
    selectedChannel === 'All' || chatState.channels.includes(selectedChannel)
      ? selectedChannel
      : 'All';

  const filteredLines = useMemo(() => {
    if (activeChannel === 'All') return chatState.lines;
    return chatState.lines.filter((line) => line.channel === activeChannel);
  }, [activeChannel, chatState.lines]);

  const handleLogScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const target = event.currentTarget;
    const bottomDistance = target.scrollHeight - target.scrollTop - target.clientHeight;
    stickToBottomRef.current = bottomDistance < 16;
  };

  return (
    <main className="overlay-shell" ref={overlayShellRef}>
      <header className="drag-bar" ref={dragBarRef}>
        <p className="title">PG Tools Overlay</p>
        <div className="window-actions no-drag">
          <button
            aria-label="Open settings"
            className="window-btn settings"
            onClick={openSettings}
            type="button"
          >
            S
          </button>
          <button
            aria-label={isLocked ? 'Unlock overlay' : 'Lock overlay'}
            className="window-btn lock"
            onClick={toggleLock}
            type="button"
          >
            {isLocked ? 'U' : 'L'}
          </button>
          <button
            aria-label="Minimize"
            className="window-btn"
            onClick={minimizeWindow}
            type="button"
          >
            _
          </button>
          <button
            aria-label="Close"
            className="window-btn close"
            onClick={closeWindow}
            type="button"
          >
            x
          </button>
        </div>
      </header>

      <section className="content">
        <div className="controls no-drag">
          <label className="channel-label" htmlFor="channel-select">
            Channel
          </label>
          <select
            className="channel-select"
            id="channel-select"
            onChange={(event) => setSelectedChannel(event.target.value)}
            value={activeChannel}
          >
            <option value="All">All</option>
            {chatState.channels.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </div>

        <div className="log-list" onScroll={handleLogScroll} ref={logListRef}>
          {filteredLines.map((line) => (
            <p className="log-line" key={line.id}>
              {line.text}
            </p>
          ))}
          {filteredLines.length === 0 && (
            <p className="log-empty">No messages for current filter.</p>
          )}
        </div>

        <p className="status-line">
          Mode: <strong>{isLocked ? 'Locked (click-through)' : 'Unlocked (interactive)'}</strong>
        </p>
        <p className="status-line file-path">
          {chatState.logPath || 'Waiting for today log file...'}
        </p>
      </section>

      <div
        className="resize-handle resize-right no-drag"
        onMouseDown={() => startResize('right')}
      />
      <div
        className="resize-handle resize-bottom no-drag"
        onMouseDown={() => startResize('bottom')}
      />
      <div
        className="resize-handle resize-corner no-drag"
        onMouseDown={() => startResize('corner')}
      />
    </main>
  );
}

function SettingsView(): React.JSX.Element {
  const [opacity, setOpacity] = useState(100);

  useEffect(() => {
    void window.api.getOverlayOpacity().then((value) => {
      setOpacity(Math.round(value * 100));
    });

    const unsubscribe = window.api.onOverlayOpacityChanged((value) => {
      setOpacity(Math.round(value * 100));
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const onOpacityChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextPercent = Number(event.target.value);
    setOpacity(nextPercent);
    void window.api.setOverlayOpacity(nextPercent / 100);
  };

  return (
    <main className="settings-shell">
      <h1 className="settings-title">Settings</h1>
      <label className="slider-label" htmlFor="opacity-slider">
        Overlay Opacity: {opacity}%
      </label>
      <input
        className="opacity-slider"
        id="opacity-slider"
        max="100"
        min="20"
        onChange={onOpacityChange}
        type="range"
        value={opacity}
      />
    </main>
  );
}

function App(): React.JSX.Element {
  return window.location.hash === '#settings' ? <SettingsView /> : <OverlayView />;
}

export default App;
