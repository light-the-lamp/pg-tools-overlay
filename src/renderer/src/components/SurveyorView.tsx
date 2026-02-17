import { useCallback, useEffect, useMemo, useState } from 'react';
import { BiSolidRightArrow } from 'react-icons/bi';

type ResizeDirection = 'right' | 'bottom' | 'corner';
type PinType = 'pin-p' | 'pin-t';

interface SurveyorViewProps {
  variant?: 'primary' | 'secondary';
}

interface SurveyMarker {
  id: number;
  type: PinType;
  xPercent: number;
  yPercent: number;
}

interface SurveyClue {
  id: number;
  xMeters: number;
  xDirection: 'east' | 'west';
  yMeters: number;
  yDirection: 'north' | 'south';
  linkedTargetMarkerId: number | null;
}

interface SurveyorState {
  started: boolean;
  clues: SurveyClue[];
  markers: SurveyMarker[];
}

export default function SurveyorView({
  variant = 'primary'
}: SurveyorViewProps): React.JSX.Element {
  const supportsPins = variant === 'primary';
  const [isLocked, setIsLocked] = useState(false);
  const [selectedPin, setSelectedPin] = useState<PinType>('pin-p');
  const [surveyorState, setSurveyorState] = useState<SurveyorState>({
    started: false,
    clues: [],
    markers: []
  });

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
    void window.api.getSurveyorState().then(setSurveyorState);

    const unsubscribeLock = window.api.onOverlayLockStateChanged((locked) => {
      setIsLocked(locked);
    });
    const unsubscribeSurveyor = window.api.onSurveyorStateChanged((state) => {
      setSurveyorState(state);
    });

    return () => {
      unsubscribeLock();
      unsubscribeSurveyor();
    };
  }, []);

  const playerPin = useMemo(
    () => surveyorState.markers.find((marker) => marker.type === 'pin-p') ?? null,
    [surveyorState.markers]
  );

  const targetPins = useMemo(
    () => surveyorState.markers.filter((marker) => marker.type === 'pin-t'),
    [surveyorState.markers]
  );
  const canStartSurvey = Boolean(playerPin) && targetPins.length > 0;

  const nearestTPinId = useMemo(() => {
    if (!playerPin || targetPins.length === 0) {
      return null;
    }

    let nearestId: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const targetPin of targetPins) {
      const dx = targetPin.xPercent - playerPin.xPercent;
      const dy = targetPin.yPercent - playerPin.yPercent;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = targetPin.id;
      }
    }

    return nearestId;
  }, [playerPin, targetPins]);

  const routePolyline = useMemo(() => {
    if (!playerPin || targetPins.length === 0) {
      return '';
    }

    const remaining = new Set(targetPins.map((pin) => pin.id));
    const ordered = [playerPin];
    let currentX = playerPin.xPercent;
    let currentY = playerPin.yPercent;

    while (remaining.size > 0) {
      let nearestTarget: (typeof targetPins)[number] | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const targetPin of targetPins) {
        if (!remaining.has(targetPin.id)) continue;
        const distance = Math.hypot(targetPin.xPercent - currentX, targetPin.yPercent - currentY);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestTarget = targetPin;
        }
      }

      if (!nearestTarget) {
        break;
      }

      ordered.push(nearestTarget);
      remaining.delete(nearestTarget.id);
      currentX = nearestTarget.xPercent;
      currentY = nearestTarget.yPercent;
    }

    return ordered.map((pin) => `${pin.xPercent},${pin.yPercent}`).join(' ');
  }, [playerPin, targetPins]);

  const pendingClueCount = useMemo(
    () => surveyorState.clues.filter((clue) => clue.linkedTargetMarkerId == null).length,
    [surveyorState.clues]
  );

  const closestLinkedClueId = useMemo(() => {
    if (!surveyorState.started || !playerPin) {
      return null;
    }

    let closestClueId: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const clue of surveyorState.clues) {
      if (clue.linkedTargetMarkerId == null) {
        continue;
      }

      const targetPin = surveyorState.markers.find(
        (marker) => marker.id === clue.linkedTargetMarkerId && marker.type === 'pin-t'
      );
      if (!targetPin) {
        continue;
      }

      const distance = Math.hypot(
        targetPin.xPercent - playerPin.xPercent,
        targetPin.yPercent - playerPin.yPercent
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestClueId = clue.id;
      }
    }

    return closestClueId;
  }, [playerPin, surveyorState.clues, surveyorState.markers, surveyorState.started]);

  const markerNumberById = useMemo(() => {
    const numbers = new Map<number, number>();
    for (const clue of surveyorState.clues) {
      if (clue.linkedTargetMarkerId == null) {
        continue;
      }
      numbers.set(clue.linkedTargetMarkerId, clue.id);
    }
    return numbers;
  }, [surveyorState.clues]);

  const inventoryRenderItems = useMemo(() => {
    if (!surveyorState.started) {
      return surveyorState.clues.map((clue) => ({ kind: 'clue' as const, clue }));
    }

    if (closestLinkedClueId == null) {
      return [];
    }

    const clueIndex = surveyorState.clues.findIndex((clue) => clue.id === closestLinkedClueId);
    if (clueIndex < 0) {
      return [];
    }

    const placeholders = Array.from({ length: clueIndex }, (_, index) => ({
      kind: 'placeholder' as const,
      key: `placeholder-${index}`
    }));
    const clue = surveyorState.clues[clueIndex];

    return [...placeholders, { kind: 'clue' as const, clue }];
  }, [closestLinkedClueId, surveyorState.clues, surveyorState.started]);

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

  const placePin = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!supportsPins || surveyorState.started) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const xPercent = ((event.clientX - bounds.left) / bounds.width) * 100;
    const yPercent = ((event.clientY - bounds.top) / bounds.height) * 100;
    void window.api.addSurveyorMarker(selectedPin, xPercent, yPercent);
  };

  const removePin = (pinId: number, event: React.MouseEvent<HTMLSpanElement>): void => {
    if (!supportsPins) {
      return;
    }
    event.stopPropagation();
    void window.api.removeSurveyorMarker(pinId);
  };

  const startSurvey = (): void => {
    void window.api.startSurveyor();
  };

  const resetSurvey = (): void => {
    void window.api.resetSurveyor();
  };

  return (
    <main
      className={`overlay-shell surveyor-shell${variant === 'secondary' ? ' surveyor-shell-secondary' : ''}`}
    >
      <header className="drag-bar">
        <p className="title">
          {variant === 'secondary' ? 'PG Tools Surveyor - Inventory' : 'PG Tools Surveyor - Map'}
        </p>
        {supportsPins ? (
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
        ) : (
          <div className="window-actions no-drag">
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
              aria-label="Close"
              className="window-btn close"
              onClick={closeWindow}
              title="Close"
              type="button"
            >
              x
            </button>
          </div>
        )}
      </header>

      <section className="surveyor-content">
        {supportsPins ? (
          <aside className="pin-menu no-drag" aria-label="Pin selection menu">
            <button
              type="button"
              className={`pin-type pin-p${selectedPin === 'pin-p' ? ' active' : ''}`}
              onClick={() => setSelectedPin('pin-p')}
              title="Select pin P"
            >
              P
            </button>
            <button
              type="button"
              className={`pin-type pin-t${selectedPin === 'pin-t' ? ' active' : ''}`}
              onClick={() => setSelectedPin('pin-t')}
              title="Select pin T"
            >
              T
            </button>
            <button
              type="button"
              className="pin-start"
              onClick={startSurvey}
              title={
                canStartSurvey
                  ? 'Start survey flow'
                  : 'Place a P marker and at least one T marker first'
              }
              disabled={!canStartSurvey}
            >
              <BiSolidRightArrow />
            </button>
            <button
              type="button"
              className="pin-reset"
              onClick={resetSurvey}
              title="Reset survey flow"
            >
              R
            </button>
          </aside>
        ) : null}

        <div
          className={`surveyor-canvas no-drag${supportsPins ? '' : ' surveyor-canvas-secondary'}`}
          role="presentation"
          onClick={supportsPins ? placePin : undefined}
          title={supportsPins ? 'Click to place selected pin' : ''}
        >
          {!supportsPins ? (
            <div className="inventory-anchor-grid" aria-hidden="true">
              {inventoryRenderItems.map((item) =>
                item.kind === 'placeholder' ? (
                  <span key={item.key} className="inventory-anchor-placeholder" />
                ) : (
                  <div key={item.clue.id} className="inventory-anchor-item">
                    <span className="inventory-anchor-square">
                      <span className="inventory-anchor-number">{item.clue.id}</span>
                    </span>
                  </div>
                )
              )}
            </div>
          ) : null}

          {supportsPins && pendingClueCount > 0 && !surveyorState.started ? (
            <p className="surveyor-prompt">Place marker to continue</p>
          ) : null}
          {supportsPins && routePolyline ? (
            <svg className="route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline className="route-line" points={routePolyline} />
            </svg>
          ) : null}
          {supportsPins &&
            surveyorState.markers.map((pin) => (
              <span
                key={pin.id}
                className={`placed-pin ${pin.type}${pin.type === 'pin-t' && pin.id === nearestTPinId ? ' nearest' : ''}`}
                style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%` }}
                onClick={(event) => removePin(pin.id, event)}
                title="Remove pin"
              >
                {pin.type === 'pin-t' && markerNumberById.has(pin.id) ? (
                  <span className="placed-pin-number">{markerNumberById.get(pin.id)}</span>
                ) : null}
              </span>
            ))}
        </div>
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
