import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatState, FontSettings } from './types';

type ResizeDirection = 'right' | 'bottom' | 'corner';

export default function ChatOverlay(): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(false);
  const [chatState, setChatState] = useState<ChatState>({ logPath: '', channels: [], lines: [] });
  const [selectedChannel, setSelectedChannel] = useState('All');
  const [fontSettings, setFontSettings] = useState<FontSettings>({ size: 12, color: '#eef3ff' });
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

  const openChatWindow = (): void => {
    void window.api.openChatWindow();
  };

  const toggleMenuWindow = (): void => {
    void window.api.toggleMenuWindow();
  };

  const startResize = useCallback((direction: ResizeDirection, startEvent: React.MouseEvent) => {
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
    void window.api.getFontSettings().then(setFontSettings);
    const unsubscribe = window.api.onFontSettingsChanged((settings) => {
      setFontSettings(settings);
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

        <div
          className="log-list"
          onScroll={handleLogScroll}
          ref={logListRef}
          style={
            {
              '--chat-font-size': `${fontSettings.size}px`,
              '--chat-font-color': fontSettings.color
            } as React.CSSProperties
          }
        >
          {filteredLines.map((line) => (
            <p className="log-line" key={line.id}>
              {line.text}
            </p>
          ))}
          {filteredLines.length === 0 && <p className="log-empty">No messages.</p>}
        </div>

        <p className="status-line">
          Mode: <strong>{isLocked ? 'Locked (click-through)' : 'Unlocked (interactive)'}</strong>
        </p>
        <p className="status-line file-path">If you need help with this app, talk to Lamplighter</p>
      </section>

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
