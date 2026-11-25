import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';
import App from './App';
import { startOffline } from './lib/pwa';
import { toast } from './state/store';
import { startSync } from './state/sync';

startOffline(() => toast('Better Me is ready to work offline'));
startSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
