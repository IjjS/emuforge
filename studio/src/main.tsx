import './ui/fonts.css';
import './ui/tokens.css';
import './ui/base.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/app';
import { loadConfig } from './app/config';
import { BUNDLED_CATALOGUES } from './i18n/bundled';
import { createLanguageStore } from './i18n/language';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Studio needs an element with id "root" in index.html.');
}

// The page's configuration is read once, at start; whoever needs it awaits the same answer.
void loadConfig();

// The current language is resolved once, before the first render, and `<html lang>` says it before anything is put
// into `#root`, so the first render is already in that language (requirement R2.7, R5.1).
const language = createLanguageStore(BUNDLED_CATALOGUES);
document.documentElement.lang = language.getState().current;

createRoot(container).render(
  <StrictMode>
    <App language={language} />
  </StrictMode>,
);
