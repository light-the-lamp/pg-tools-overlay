import { useEffect } from 'react';
import ChatOverlay from './components/ChatOverlay';
import MenuView from './components/MenuView';
import SettingsView from './components/SettingsView';
import StatsView from './components/StatsView';
import SurveyorView from './components/SurveyorView';

function App(): React.JSX.Element {
  useEffect(() => {
    let lastAckAt = 0;
    const acknowledgeNotifications = (): void => {
      const now = Date.now();
      if (now - lastAckAt < 300) {
        return;
      }

      lastAckAt = now;
      void window.api.markChatNotificationsSeen();
    };

    window.addEventListener('pointerdown', acknowledgeNotifications);
    window.addEventListener('keydown', acknowledgeNotifications);

    return () => {
      window.removeEventListener('pointerdown', acknowledgeNotifications);
      window.removeEventListener('keydown', acknowledgeNotifications);
    };
  }, []);

  if (window.location.hash === '#settings') {
    return <SettingsView />;
  }
  if (window.location.hash === '#menu') {
    return <MenuView />;
  }
  if (window.location.hash === '#stats') {
    return <StatsView />;
  }
  if (window.location.hash === '#surveyor') {
    return <SurveyorView />;
  }
  return <ChatOverlay />;
}

export default App;
