import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { LanguageStore } from '../i18n/language';
import { LanguageProvider } from '../i18n/language-provider';
import { createQueryClient } from './query-client';

interface ProvidersProps {
  /** The page's current language, resolved at start (`main.tsx`); by default one resolved now from the browser. */
  language?: LanguageStore | undefined;
  children: ReactNode;
}

/** Everything the pages share above the router: the current language and the query client. */
export function Providers({ language, children }: ProvidersProps) {
  const [queryClient] = useState(createQueryClient);
  return (
    <LanguageProvider store={language}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </LanguageProvider>
  );
}
