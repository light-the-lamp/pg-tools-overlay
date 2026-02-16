import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CombatSkillWatcherState, StatsState } from './types';

type ResizeDirection = 'right' | 'bottom' | 'corner';

const combatSkills = [
  'Animal Handling',
  'Archery',
  'Bard',
  'Battle Chemistry',
  'Cow',
  'Crossbow',
  'Deer',
  'Druid',
  'Fairy Magic',
  'Fire Magic',
  'Giant Bat',
  'Hammer',
  'Ice Magic',
  'Knife Fighting',
  'Lycanthropy',
  'Mentalism',
  'Necromancy',
  'Pig',
  'Priest',
  'Psychology',
  'Rabbit',
  'Shield',
  'Spider',
  'Spirit Fox',
  'Staff',
  'Sword',
  'Unarmed',
  'Vampirism',
  'Warden',
  'Weather Witching',
  'Survival Instincts',
  'Armor Patching',
  'First Aid'
] as const;

export default function CombatSkillWatcherView(): React.JSX.Element {
  const [isLocked, setIsLocked] = useState(false);
  const [watcherState, setWatcherState] = useState<CombatSkillWatcherState>({ selectedSkills: [] });
  const [searchText, setSearchText] = useState('');
  const [statsState, setStatsState] = useState<StatsState>({ xpGains: [], levelUps: [] });

  const selectedSkills = useMemo(
    () => new Set(watcherState.selectedSkills),
    [watcherState.selectedSkills]
  );
  const skillsSeenInXpLogs = useMemo(() => {
    return new Set(
      statsState.xpGains
        .filter((entry) => entry.value > 0)
        .map((entry) => entry.skill.trim().toLocaleLowerCase())
    );
  }, [statsState.xpGains]);
  const filteredSkills = useMemo(() => {
    const needle = searchText.trim().toLocaleLowerCase();
    if (!needle) {
      return combatSkills.filter((skill) => !selectedSkills.has(skill)).slice(0, 12);
    }

    return combatSkills
      .filter((skill) => !selectedSkills.has(skill))
      .filter((skill) => skill.toLocaleLowerCase().includes(needle))
      .slice(0, 12);
  }, [searchText, selectedSkills]);

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
    void window.api.getCombatSkillWatcherState().then(setWatcherState);
    const unsubscribe = window.api.onCombatSkillWatcherStateChanged((state) => {
      setWatcherState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void window.api.getStatsState().then(setStatsState);
    const unsubscribe = window.api.onStatsStateChanged((state) => {
      setStatsState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const saveSelectedSkills = (skills: string[]): void => {
    void window.api.setCombatSkillWatcherSkills(skills).then(setWatcherState);
  };

  const addSkill = (skill: string): void => {
    if (!skill || selectedSkills.has(skill)) {
      return;
    }

    const next = combatSkills.filter((entry) => selectedSkills.has(entry) || entry === skill);
    saveSelectedSkills(next);
    setSearchText('');
  };

  const removeSkill = (skill: string): void => {
    const next = combatSkills.filter((entry) => entry !== skill && selectedSkills.has(entry));
    saveSelectedSkills(next);
  };

  const clearAll = (): void => {
    saveSelectedSkills([]);
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
    <main className="overlay-shell combat-skill-watcher-shell">
      <header className="drag-bar">
        <p className="title">Combat Skill Watcher</p>
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

      <section className="combat-skill-watcher-content no-drag">
        <div className="combat-skill-watcher-actions">
          <input
            className="combat-skill-watcher-search-input"
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addSkill(filteredSkills[0] ?? '');
              }
            }}
            placeholder="Search skill..."
            type="text"
            value={searchText}
          />
          <button
            className="combat-skill-watcher-btn"
            disabled={filteredSkills.length === 0}
            onClick={() => addSkill(filteredSkills[0] ?? '')}
            type="button"
          >
            Add
          </button>
          <button
            className="combat-skill-watcher-btn combat-skill-watcher-btn-danger"
            onClick={clearAll}
            disabled={watcherState.selectedSkills.length === 0}
            type="button"
          >
            Clear
          </button>
        </div>

        {filteredSkills.length > 0 && searchText.trim() ? (
          <div className="combat-skill-watcher-suggestions">
            {filteredSkills.map((skill) => (
              <button
                className="combat-skill-watcher-suggestion-item"
                key={skill}
                onClick={() => addSkill(skill)}
                type="button"
              >
                {skill}
              </button>
            ))}
          </div>
        ) : null}

        <div className="combat-skill-watcher-list">
          {watcherState.selectedSkills.map((skill) => {
            const hasXpEarned = skillsSeenInXpLogs.has(skill.toLocaleLowerCase());
            return (
              <div className="combat-skill-watcher-item" key={skill}>
                <span>{skill}</span>
                <div className="combat-skill-watcher-item-actions">
                  <span
                    aria-label={hasXpEarned ? 'Skill has XP' : 'Skill missing XP'}
                    className={
                      hasXpEarned
                        ? 'combat-skill-watcher-status is-match'
                        : 'combat-skill-watcher-status is-missing'
                    }
                    title={hasXpEarned ? 'XP found in logs' : 'No XP found in logs'}
                  >
                    {hasXpEarned ? '✓' : 'X'}
                  </span>
                  <button
                    className="combat-skill-watcher-remove-btn"
                    onClick={() => removeSkill(skill)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {watcherState.selectedSkills.length === 0 ? (
            <p className="combat-skill-watcher-empty">No watched skills yet.</p>
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
