import { useCallback, useEffect, useMemo, useState } from 'react';

type ResizeDirection = 'right' | 'bottom' | 'corner';
type PinType = 'pin-p' | 'pin-t';

type PlacedPin = {
  id: number;
  type: PinType;
  xPercent: number;
  yPercent: number;
};

type RouteSolution = {
  orderedTargetIds: number[];
};

export default function SurveyorView(): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(false);
  const [selectedPin, setSelectedPin] = useState<PinType>('pin-p');
  const [placedPins, setPlacedPins] = useState<PlacedPin[]>([]);

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
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    const xPercent = ((event.clientX - bounds.left) / bounds.width) * 100;
    const yPercent = ((event.clientY - bounds.top) / bounds.height) * 100;

    setPlacedPins((currentPins) => {
      if (selectedPin === 'pin-p') {
        const existingPlayerPin = currentPins.find((pin) => pin.type === 'pin-p');
        if (existingPlayerPin) {
          return currentPins.map((pin) =>
            pin.id === existingPlayerPin.id ? { ...pin, xPercent, yPercent } : pin
          );
        }
      }

      return [
        ...currentPins,
        {
          id: Date.now() + currentPins.length,
          type: selectedPin,
          xPercent,
          yPercent
        }
      ];
    });
  };

  const clearPins = (): void => {
    setPlacedPins([]);
  };

  const removePin = (pinId: number, event: React.MouseEvent<HTMLSpanElement>): void => {
    event.stopPropagation();
    setPlacedPins((currentPins) => currentPins.filter((pin) => pin.id !== pinId));
  };

  const nearestTPinId = useMemo(() => {
    const playerPin = placedPins.find((pin) => pin.type === 'pin-p');
    if (!playerPin) {
      return null;
    }

    const targetPins = placedPins.filter((pin) => pin.type === 'pin-t');
    if (targetPins.length === 0) {
      return null;
    }

    let nearestPinId = targetPins[0].id;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const targetPin of targetPins) {
      const dx = targetPin.xPercent - playerPin.xPercent;
      const dy = targetPin.yPercent - playerPin.yPercent;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestPinId = targetPin.id;
      }
    }

    return nearestPinId;
  }, [placedPins]);

  const routeSolution = useMemo<RouteSolution | null>(() => {
    const playerPin = placedPins.find((pin) => pin.type === 'pin-p');
    if (!playerPin) {
      return null;
    }

    const targetPins = placedPins.filter((pin) => pin.type === 'pin-t');
    if (targetPins.length === 0) {
      return null;
    }

    const targetCount = targetPins.length;

    const distanceFromPlayer = targetPins.map((targetPin) =>
      Math.hypot(targetPin.xPercent - playerPin.xPercent, targetPin.yPercent - playerPin.yPercent)
    );

    const pairDistance = Array.from({ length: targetCount }, (_, i) =>
      Array.from({ length: targetCount }, (_, j) =>
        Math.hypot(
          targetPins[i].xPercent - targetPins[j].xPercent,
          targetPins[i].yPercent - targetPins[j].yPercent
        )
      )
    );

    if (targetCount > 11) {
      // Fallback for larger sets: greedy nearest-neighbor from current point.
      const remaining = new Set(targetPins.map((pin) => pin.id));
      const orderedTargetIds: number[] = [];
      let currentX = playerPin.xPercent;
      let currentY = playerPin.yPercent;

      while (remaining.size > 0) {
        let nearestTargetId: number | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;

        for (const targetPin of targetPins) {
          if (!remaining.has(targetPin.id)) {
            continue;
          }

          const distance = Math.hypot(targetPin.xPercent - currentX, targetPin.yPercent - currentY);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestTargetId = targetPin.id;
          }
        }

        if (nearestTargetId == null) {
          break;
        }

        orderedTargetIds.push(nearestTargetId);
        remaining.delete(nearestTargetId);
        const selectedTarget = targetPins.find((pin) => pin.id === nearestTargetId);
        if (!selectedTarget) {
          break;
        }
        currentX = selectedTarget.xPercent;
        currentY = selectedTarget.yPercent;
      }

      return { orderedTargetIds };
    }

    const fullMask = (1 << targetCount) - 1;
    const dp: number[][] = Array.from({ length: 1 << targetCount }, () =>
      Array.from({ length: targetCount }, () => Number.POSITIVE_INFINITY)
    );
    const prev: number[][] = Array.from({ length: 1 << targetCount }, () =>
      Array.from({ length: targetCount }, () => -1)
    );

    for (let i = 0; i < targetCount; i += 1) {
      dp[1 << i][i] = distanceFromPlayer[i];
    }

    for (let mask = 1; mask <= fullMask; mask += 1) {
      for (let last = 0; last < targetCount; last += 1) {
        if ((mask & (1 << last)) === 0) {
          continue;
        }

        const currentCost = dp[mask][last];
        if (!Number.isFinite(currentCost)) {
          continue;
        }

        for (let next = 0; next < targetCount; next += 1) {
          if ((mask & (1 << next)) !== 0) {
            continue;
          }

          const nextMask = mask | (1 << next);
          const nextCost = currentCost + pairDistance[last][next];
          if (nextCost < dp[nextMask][next]) {
            dp[nextMask][next] = nextCost;
            prev[nextMask][next] = last;
          }
        }
      }
    }

    let bestLast = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let last = 0; last < targetCount; last += 1) {
      if (dp[fullMask][last] < bestCost) {
        bestCost = dp[fullMask][last];
        bestLast = last;
      }
    }

    const orderIndices: number[] = [];
    let mask = fullMask;
    let cursor = bestLast;
    while (cursor !== -1) {
      orderIndices.push(cursor);
      const previous = prev[mask][cursor];
      mask &= ~(1 << cursor);
      cursor = previous;
    }
    orderIndices.reverse();

    return {
      orderedTargetIds: orderIndices.map((targetIndex) => targetPins[targetIndex].id)
    };
  }, [placedPins]);

  const routePolyline = useMemo(() => {
    const playerPin = placedPins.find((pin) => pin.type === 'pin-p');
    if (!playerPin || !routeSolution || routeSolution.orderedTargetIds.length === 0) {
      return '';
    }

    const orderedPins = [playerPin];
    for (const targetId of routeSolution.orderedTargetIds) {
      const targetPin = placedPins.find((pin) => pin.id === targetId);
      if (targetPin) {
        orderedPins.push(targetPin);
      }
    }

    return orderedPins.map((pin) => `${pin.xPercent},${pin.yPercent}`).join(' ');
  }, [placedPins, routeSolution]);

  return (
    <main className="overlay-shell surveyor-shell">
      <header className="drag-bar">
        <p className="title">PG Tools Surveyor</p>
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

      <section className="surveyor-content">
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
            className="pin-reset"
            onClick={clearPins}
            title="Clear all pins"
            disabled={placedPins.length === 0}
          >
            R
          </button>
        </aside>

        <div
          className="surveyor-canvas no-drag"
          role="presentation"
          onClick={placePin}
          title="Click to place selected pin"
        >
          {routePolyline ? (
            <svg className="route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline className="route-line" points={routePolyline} />
            </svg>
          ) : null}
          {placedPins.map((pin) => (
            <span
              key={pin.id}
              className={`placed-pin ${pin.type}${pin.type === 'pin-t' && pin.id === nearestTPinId ? ' nearest' : ''}`}
              style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%` }}
              onClick={(event) => removePin(pin.id, event)}
              title="Remove pin"
            />
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
