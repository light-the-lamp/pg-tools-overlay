export default function MenuView(): React.JSX.Element {
  const openStats = (): void => {
    void window.api.openStatsWindow();
  };

  const openChatWindow = (): void => {
    void window.api.openChatWindow();
  };

  return (
    <main className="overlay-shell menu-shell no-drag">
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
