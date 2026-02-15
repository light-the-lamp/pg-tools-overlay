import { useEffect, useState } from 'react';
import type { FontSettings } from './types';

export default function SettingsView(): React.JSX.Element {
  const [opacity, setOpacity] = useState(100);
  const [fontSettings, setFontSettings] = useState<FontSettings>({ size: 12, color: '#eef3ff' });

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
    </main>
  );
}
