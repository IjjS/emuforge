import './ui/fonts.css';
import './ui/tokens.css';
import './ui/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { loadConfig } from './app/config';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Studio needs an element with id "root" in index.html.');
}

// The page's configuration is read once, at start; whoever needs it awaits the same answer.
void loadConfig();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
