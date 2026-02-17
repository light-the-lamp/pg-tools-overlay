import { useEffect, useState } from 'react';
import type { ChatNotificationState, FontSettings, SurveyorGridSettings } from './types';

export default function SettingsView(): React.JSX.Element {
  const [opacity, setOpacity] = useState(100);
  const [fontSettings, setFontSettings] = useState<FontSettings>({ size: 12, color: '#eef3ff' });
  const [surveyorGridSettings, setSurveyorGridSettings] = useState<SurveyorGridSettings>({
    thickness: 2,
    color: '#f4da46',
    gap: 10,
    columns: 10,
    size: 50
  });
  const [, setChatNotificationState] = useState<ChatNotificationState>({
    keywords: [],
    matchCount: 0
  });
  const [keywordsInput, setKeywordsInput] = useState('');

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
    void window.api.getChatNotificationState().then((state) => {
      setChatNotificationState(state);
      setKeywordsInput(state.keywords.join('\n'));
    });

    const unsubscribe = window.api.onChatNotificationStateChanged((state) => {
      setChatNotificationState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void window.api.getSurveyorGridSettings().then(setSurveyorGridSettings);
    const unsubscribe = window.api.onSurveyorGridSettingsChanged((settings) => {
      setSurveyorGridSettings(settings);
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

  const onFontSizeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextSize = Number(event.target.value);
    setFontSettings((current) => ({ ...current, size: nextSize }));
    void window.api.setFontSettings({ ...fontSettings, size: nextSize });
  };

  const onFontColorChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextColor = event.target.value;
    setFontSettings((current) => ({ ...current, color: nextColor }));
    void window.api.setFontSettings({ ...fontSettings, color: nextColor });
  };

  const onSurveyorThicknessChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const thickness = Number(event.target.value);
    const nextSettings = { ...surveyorGridSettings, thickness };
    setSurveyorGridSettings(nextSettings);
    void window.api.setSurveyorGridSettings(nextSettings);
  };

  const onSurveyorColorChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const color = event.target.value;
    const nextSettings = { ...surveyorGridSettings, color };
    setSurveyorGridSettings(nextSettings);
    void window.api.setSurveyorGridSettings(nextSettings);
  };

  const onSurveyorGapChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const gap = Number(event.target.value);
    const nextSettings = { ...surveyorGridSettings, gap };
    setSurveyorGridSettings(nextSettings);
    void window.api.setSurveyorGridSettings(nextSettings);
  };

  const onSurveyorColumnsChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const columns = Number(event.target.value);
    const nextSettings = { ...surveyorGridSettings, columns };
    setSurveyorGridSettings(nextSettings);
    void window.api.setSurveyorGridSettings(nextSettings);
  };

  const onSurveyorSizeChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const size = Number(event.target.value);
    const nextSettings = { ...surveyorGridSettings, size };
    setSurveyorGridSettings(nextSettings);
    void window.api.setSurveyorGridSettings(nextSettings);
  };

  const saveNotificationKeywords = (): void => {
    const keywords = keywordsInput
      .split(/\r?\n/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    void window.api.setChatNotificationKeywords(keywords).then((state) => {
      setChatNotificationState(state);
      setKeywordsInput(state.keywords.join('\n'));
    });
  };

  return (
    <main className="overlay-shell">
      <div className="settings-shell">
        <h1 className="settings-title">Application settings</h1>
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
        <label className="slider-label" htmlFor="font-size-slider">
          Chat Font Size: {fontSettings.size}px
        </label>
        <input
          className="opacity-slider"
          id="font-size-slider"
          max="22"
          min="10"
          onChange={onFontSizeChange}
          type="range"
          value={fontSettings.size}
        />
        <label className="slider-label" htmlFor="font-color-picker">
          Chat Font Color
        </label>
        <input
          className="color-picker"
          id="font-color-picker"
          onChange={onFontColorChange}
          type="color"
          value={fontSettings.color}
        />
        <h1 className="settings-title settings-section">Notification</h1>
        <label className="slider-label" htmlFor="chat-keywords">
          Chat Alert Keywords (one per line)
        </label>
        <textarea
          className="keywords-input"
          id="chat-keywords"
          onChange={(event) => setKeywordsInput(event.target.value)}
          placeholder="boss&#10;myname&#10;help"
          rows={6}
          value={keywordsInput}
        />
        <button className="save-keywords-btn" onClick={saveNotificationKeywords} type="button">
          Save Alert Keywords
        </button>
        <h1 className="settings-title settings-section">Surveyor</h1>
        <label className="slider-label" htmlFor="surveyor-grid-thickness-slider">
          Surveyor Square Thickness: {surveyorGridSettings.thickness}px
        </label>
        <input
          className="opacity-slider"
          id="surveyor-grid-thickness-slider"
          max="8"
          min="1"
          onChange={onSurveyorThicknessChange}
          type="range"
          value={surveyorGridSettings.thickness}
        />
        <label className="slider-label" htmlFor="surveyor-grid-color-picker">
          Surveyor Square Color
        </label>
        <input
          className="color-picker"
          id="surveyor-grid-color-picker"
          onChange={onSurveyorColorChange}
          type="color"
          value={surveyorGridSettings.color}
        />
        <label className="slider-label" htmlFor="surveyor-grid-gap-slider">
          Surveyor Square Gap: {surveyorGridSettings.gap}px
        </label>
        <input
          className="opacity-slider"
          id="surveyor-grid-gap-slider"
          max="24"
          min="0"
          onChange={onSurveyorGapChange}
          type="range"
          value={surveyorGridSettings.gap}
        />
        <label className="slider-label" htmlFor="surveyor-grid-columns-slider">
          Surveyor Grid Columns: {surveyorGridSettings.columns}
        </label>
        <input
          className="opacity-slider"
          id="surveyor-grid-columns-slider"
          max="20"
          min="1"
          onChange={onSurveyorColumnsChange}
          type="range"
          value={surveyorGridSettings.columns}
        />
        <label className="slider-label" htmlFor="surveyor-grid-size-slider">
          Surveyor Square Size: {surveyorGridSettings.size}px
        </label>
        <input
          className="opacity-slider"
          id="surveyor-grid-size-slider"
          max="120"
          min="20"
          onChange={onSurveyorSizeChange}
          type="range"
          value={surveyorGridSettings.size}
        />
      </div>
    </main>
  );
}
