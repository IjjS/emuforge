import { createContext, useContext } from 'react';

import type { MessageKey } from './catalogue';
import type { Messages } from './messages';

/** A language Studio has: its tag and its own name (R1.1). */
export interface LanguageName {
  readonly tag: string;
  readonly name: string;
}

/** The current language of Studio's own layer: its messages and formats, and the choice that made it current. */
export interface Language<K extends string = MessageKey> extends Messages<K> {
  /** The tag the user chose, or `null` while Studio follows the browser ("Browser language"). */
  readonly choice: string | null;
  /** The language the browser's languages resolved to at start. */
  readonly browser: string;
  /** Every language Studio has, one per catalogue, in the order of their tags. */
  readonly languages: readonly LanguageName[];
  /** Choose a language by its tag, or `null` for "Browser language" (R2.4, R2.6). */
  readonly choose: (tag: string | null) => void;
}

export const LanguageContext = createContext<Language<string> | null>(null);

/**
 * The current language; only inside a `LanguageProvider`. Its message keys are the English catalogue's; a test that
 * gives test catalogues names its own.
 */
export function useLanguage<K extends string = MessageKey>(): Language<K> {
  const language = useContext(LanguageContext);
  if (language === null) {
    throw new Error('useLanguage() is used outside a LanguageProvider.');
  }
  return language;
}
