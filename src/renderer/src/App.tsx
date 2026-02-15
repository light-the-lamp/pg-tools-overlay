import ChatOverlay from './components/ChatOverlay';
import MenuView from './components/MenuView';
import SettingsView from './components/SettingsView';
import StatsView from './components/StatsView';
import SurveyorView from './components/SurveyorView';

function App(): React.JSX.Element {
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
