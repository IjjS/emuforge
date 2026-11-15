import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

import { BUNDLED_CATALOGUES } from './bundled';
import { createLanguageStore, type LanguageState, type LanguageStore } from './language';
import { LanguageContext, type Language } from './language-context';
import { messagesFor } from './messages';

interface LanguageProviderProps {
  /** The page's current language; by default one resolved now from the browser and the bundled catalogues. */
  store?: LanguageStore | undefined;
  children: ReactNode;
}

/** What the hook gives for `state`: the messages of its current language, and the choice that made it current. */
function languageOf(store: LanguageStore, state: LanguageState): Language<string> {
  return {
    ...messagesFor<string>(store.catalogues, state.current),
    choice: state.choice,
    browser: state.browser,
    languages: Array.from(store.catalogues.byTag.values(), ({ tag, name }) => ({ tag, name })),
    choose: store.choose,
  };
}

/**
 * Gives Studio's own layer its current language. A change of it re-renders what reads it, in one step and on the same
 * page (R2.6, R2.7), and sets `<html lang>` to it (R5.1).
 */
export function LanguageProvider({ store: given, children }: LanguageProviderProps) {
  const [store] = useState(() => given ?? createLanguageStore(BUNDLED_CATALOGUES));
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const language = useMemo(() => languageOf(store, state), [store, state]);
  useLayoutEffect(() => {
    document.documentElement.lang = language.tag;
  }, [language.tag]);
  return <LanguageContext value={language}>{children}</LanguageContext>;
}
