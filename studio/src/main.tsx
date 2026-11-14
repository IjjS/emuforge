import '@cloudscape-design/global-styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { followColorScheme } from './app/color-mode';
import { loadConfig } from './app/config';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Studio needs an element with id "root" in index.html.');
}

followColorScheme();
// The page's configuration is read once, at start; whoever needs it awaits the same answer.
void loadConfig();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
