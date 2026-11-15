// The current language (requirement R2): resolved once at start from a stored choice or the browser's languages,
// changed by a choice, which is stored in `localStorage` when the browser lets it be.

import type { Catalogues } from './catalogue';

/** The `localStorage` key of the language the user chose (R2.4); its value is the language's tag. */
export const STORAGE_KEY = 'emuforge.studio.language';

/** What the current language is resolved from; Studio's start reads the browser's, a test gives its own. */
export interface LanguageEnvironment {
  /** The browser's preferred languages, in order (`navigator.languages`). */
  readonly languages: readonly string[];
  /** The browser's language (`navigator.language`), used when `languages` is empty. */
  readonly language: string;
  /** The browser's `localStorage`; reaching it may throw (blocked storage), and so may each read or write. */
  readonly storage: () => Storage;
}

/** The current language and what it came from. */
export interface LanguageState {
  /** The tag of the language Studio's own layer is shown in. */
  readonly current: string;
  /** The tag of the language the user chose, or `null` while Studio follows the browser ("Browser language"). */
  readonly choice: string | null;
  /** The language the browser's languages resolved to at start (R2.2, R2.3). */
  readonly browser: string;
}

/** The current language, held for the page's life; `subscribe` and `getState` suit `useSyncExternalStore`. */
export interface LanguageStore {
  readonly catalogues: Catalogues;
  getState(): LanguageState;
  subscribe(listener: () => void): () => void;
  /** Choose a language by its tag, or `null` for "Browser language" (R2.4, R3.6). */
  choose(tag: string | null): void;
}

/** The browser Studio runs in. */
export function browserEnvironment(): LanguageEnvironment {
  return {
    languages: navigator.languages,
    language: navigator.language,
    storage: () => window.localStorage,
  };
}

function primarySubtag(tag: string): string {
  return tag.split('-')[0]?.toLowerCase() ?? '';
}

/**
 * The tag of the first of `preferred` that matches one of `tags` (R2.2): equal to it ignoring case, or with the same
 * primary subtag (`de-AT` → `de`, `pt-PT` → `pt-BR`). `undefined` when none does.
 */
export function matchLanguage(preferred: readonly string[], tags: readonly string[]): string | undefined {
  for (const wanted of preferred) {
    if (wanted === '') {
      continue;
    }
    const exact = tags.find((tag) => tag.toLowerCase() === wanted.toLowerCase());
    if (exact !== undefined) {
      return exact;
    }
    const primary = primarySubtag(wanted);
    const same = tags.find((tag) => primarySubtag(tag) === primary);
    if (same !== undefined) {
      return same;
    }
  }
  return undefined;
}

/** The language of the browser's preferred languages, or English when none matches (R2.2). */
export function browserLanguage(catalogues: Catalogues, environment: LanguageEnvironment): string {
  const preferred = environment.languages.length > 0 ? environment.languages : [environment.language];
  return matchLanguage(preferred, [...catalogues.byTag.keys()]) ?? catalogues.source.tag;
}

/** Runs `step` on the browser's storage; blocked storage is not an error Studio shows (R2.4). */
function tryStorage<T>(environment: LanguageEnvironment, step: (storage: Storage) => T): T | undefined {
  try {
    return step(environment.storage());
  } catch {
    return undefined;
  }
}

/** The stored choice when it is a tag of `catalogues`; any other stored value is removed (R2.4). */
function storedChoice(catalogues: Catalogues, environment: LanguageEnvironment): string | null {
  const stored = tryStorage(environment, (storage) => storage.getItem(STORAGE_KEY)) ?? null;
  if (stored === null) {
    return null;
  }
  if (catalogues.byTag.has(stored)) {
    return stored;
  }
  tryStorage(environment, (storage) => {
    storage.removeItem(STORAGE_KEY);
  });
  return null;
}

/**
 * The current language of a page, resolved now: a stored choice over the browser's languages. The browser's
 * languages are read once, here; a change of them applies at the next start (R2.3), and a choice made in another tab
 * at this tab's next start (R2.5).
 */
export function createLanguageStore(
  catalogues: Catalogues,
  environment: LanguageEnvironment = browserEnvironment(),
): LanguageStore {
  const browser = browserLanguage(catalogues, environment);
  const choice = storedChoice(catalogues, environment);
  let state: LanguageState = { current: choice ?? browser, choice, browser };
  const listeners = new Set<() => void>();
  return {
    catalogues,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    choose(tag) {
      if (tag === state.choice || (tag !== null && !catalogues.byTag.has(tag))) {
        return;
      }
      tryStorage(environment, (storage) => {
        if (tag === null) {
          storage.removeItem(STORAGE_KEY);
        } else {
          storage.setItem(STORAGE_KEY, tag);
        }
      });
      state = { current: tag ?? browser, choice: tag, browser };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
