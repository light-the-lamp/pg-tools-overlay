import { useCallback, useEffect, useMemo, useState } from 'react';
import itemsData from '../assets/pg-items.json';
import type { LootObjectiveConfig, LootTrackerState } from './types';

type ResizeDirection = 'right' | 'bottom' | 'corner';

type ItemRecord = {
  Name?: string;
};

type ItemDatabase = Record<string, ItemRecord>;

const allItemNames = Object.values(itemsData as ItemDatabase)
  .map((item) => item.Name?.trim())
  .filter((itemName): itemName is string => Boolean(itemName))
  .sort((a, b) => a.localeCompare(b));

export default function LootTrackerView(): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(false);
  const [trackerState, setTrackerState] = useState<LootTrackerState>({ objectives: [] });
  const [searchText, setSearchText] = useState('');
  const [targetInput, setTargetInput] = useState(1);
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set());

  const selectedItems = useMemo(
    () => new Set(trackerState.objectives.map((objective) => objective.itemName)),
    [trackerState.objectives]
  );

  const filteredItems = useMemo(() => {
    const needle = searchText.trim().toLocaleLowerCase();
    if (!needle) {
      return allItemNames.filter((itemName) => !selectedItems.has(itemName)).slice(0, 12);
    }

    return allItemNames
      .filter((itemName) => !selectedItems.has(itemName))
      .filter((itemName) => itemName.toLocaleLowerCase().includes(needle))
      .slice(0, 12);
  }, [searchText, selectedItems]);

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
    void window.api.getLootTrackerState().then(setTrackerState);
    const unsubscribe = window.api.onLootTrackerStateChanged((state) => {
      setTrackerState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setSelectedForRemoval((current) => {
      const names = new Set(trackerState.objectives.map((objective) => objective.itemName));
      const next = new Set<string>();
      for (const name of current) {
        if (names.has(name)) {
          next.add(name);
        }
      }
      return next;
    });
  }, [trackerState.objectives]);

  const addObjective = (itemName: string): void => {
    if (!itemName || selectedItems.has(itemName)) {
      return;
    }

    const nextObjectives: LootObjectiveConfig[] = [
      ...trackerState.objectives.map((objective) => ({
        itemName: objective.itemName,
        target: objective.target
      })),
      { itemName, target: Math.max(1, Math.floor(targetInput) || 1) }
    ];
    void window.api.setLootTrackerObjectives(nextObjectives).then(setTrackerState);
    setSearchText('');
  };

  const removeObjective = (itemName: string): void => {
    const nextObjectives: LootObjectiveConfig[] = trackerState.objectives
      .filter((objective) => objective.itemName !== itemName)
      .map((objective) => ({ itemName: objective.itemName, target: objective.target }));
    void window.api.setLootTrackerObjectives(nextObjectives).then(setTrackerState);
  };

  const removeSelectedObjectives = (): void => {
    if (selectedForRemoval.size === 0) {
      return;
    }

    const nextObjectives: LootObjectiveConfig[] = trackerState.objectives
      .filter((objective) => !selectedForRemoval.has(objective.itemName))
      .map((objective) => ({ itemName: objective.itemName, target: objective.target }));
    void window.api.setLootTrackerObjectives(nextObjectives).then(setTrackerState);
    setSelectedForRemoval(new Set());
  };

  const toggleSelectedForRemoval = (itemName: string): void => {
    setSelectedForRemoval((current) => {
      const next = new Set(current);
      if (next.has(itemName)) {
        next.delete(itemName);
      } else {
        next.add(itemName);
      }
      return next;
    });
  };

  const setObjectiveCount = (itemName: string, nextCount: number): void => {
    void window.api.setLootTrackerObjectiveCount(itemName, nextCount).then(setTrackerState);
  };

  const setObjectiveTarget = (itemName: string, nextTarget: number): void => {
    const safeTarget = Math.max(1, Math.floor(nextTarget) || 1);
    const nextObjectives: LootObjectiveConfig[] = trackerState.objectives.map((objective) =>
      objective.itemName === itemName ? { itemName, target: safeTarget } : objective
    );
    void window.api.setLootTrackerObjectives(nextObjectives).then(setTrackerState);
  };

  const allSelected =
    trackerState.objectives.length > 0 &&
    selectedForRemoval.size === trackerState.objectives.length;

  const toggleSelectAll = (): void => {
    if (allSelected) {
      setSelectedForRemoval(new Set());
      return;
    }

    setSelectedForRemoval(new Set(trackerState.objectives.map((objective) => objective.itemName)));
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

  const minimizeWindow = (): void => {
    void window.api.minimizeWindow();
  };

  const closeWindow = (): void => {
    void window.api.closeWindow();
  };

  return (
    <main className="overlay-shell loot-tracker-shell">
      <header className="drag-bar">
        <p className="title">Loot Tracker</p>
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

      <section className="loot-content no-drag">
        <div className="loot-search-row">
          <input
            className="loot-search-input"
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
            placeholder="Search item..."
            type="text"
            value={searchText}
          />
          <input
            className="loot-target-input"
            min={1}
            onChange={(event) => setTargetInput(Math.max(1, Number(event.target.value) || 1))}
            type="number"
            value={targetInput}
          />
          <button
            className="loot-add-btn"
            disabled={filteredItems.length === 0}
            onClick={() => addObjective(filteredItems[0] ?? '')}
            type="button"
          >
            Add
          </button>
          <button
            className="loot-select-all-btn"
            disabled={trackerState.objectives.length === 0}
            onClick={toggleSelectAll}
            type="button"
          >
            {allSelected ? 'Clear' : 'Select All'}
          </button>
          <button
            className="loot-remove-selected-btn"
            disabled={selectedForRemoval.size === 0}
            onClick={removeSelectedObjectives}
            type="button"
          >
            Remove Selected ({selectedForRemoval.size})
          </button>
        </div>

        {filteredItems.length > 0 && searchText.trim() ? (
          <div className="loot-suggestions">
            {filteredItems.map((itemName) => (
              <button
                className="loot-suggestion-item"
                key={itemName}
                onClick={() => setSearchText(itemName)}
                type="button"
              >
                {itemName}
              </button>
            ))}
          </div>
        ) : null}

        <div className="loot-objectives">
          {trackerState.objectives.map((objective) => (
            <div className="loot-objective-row" key={objective.itemName}>
              <div className="loot-objective-main">
                <label className="loot-select-toggle">
                  <input
                    checked={selectedForRemoval.has(objective.itemName)}
                    onChange={() => toggleSelectedForRemoval(objective.itemName)}
                    type="checkbox"
                  />
                </label>
                <p className="loot-objective-name">{objective.itemName}</p>
                <div className="loot-progress-editor">
                  <input
                    className="loot-objective-count-input"
                    min={0}
                    onChange={(event) =>
                      setObjectiveCount(objective.itemName, Number(event.target.value))
                    }
                    type="number"
                    value={objective.count}
                  />
                  <span className="loot-progress-separator">/</span>
                  <input
                    className="loot-objective-target-input"
                    min={1}
                    onChange={(event) =>
                      setObjectiveTarget(objective.itemName, Number(event.target.value))
                    }
                    type="number"
                    value={objective.target}
                  />
                </div>
              </div>
              <button
                className="loot-remove-btn"
                onClick={() => removeObjective(objective.itemName)}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
          {trackerState.objectives.length === 0 ? (
            <p className="loot-empty">No objectives selected.</p>
          ) : null}
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
