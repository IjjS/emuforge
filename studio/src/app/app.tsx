import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';

import type { LanguageStore } from '../i18n/language';
import { Providers } from './providers';
import { routes } from './routes';

interface AppProps {
  /** The page's current language, resolved before the first render (`main.tsx`). */
  language?: LanguageStore | undefined;
}

/** Studio: its frame and routes in the browser's history, in the page's current language. */
export function App({ language }: AppProps) {
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <Providers language={language}>
      <RouterProvider router={router} />
    </Providers>
  );
}
