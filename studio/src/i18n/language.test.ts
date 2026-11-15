// The current language at start and on a choice (requirement R2.2-R2.5), on test catalogues of the twelve languages
// of R1.1 and a browser the test describes.

import { describe, expect, it } from 'vitest';

import { catalogueSet, parseCatalogue, type Catalogues } from './catalogue';
import { createLanguageStore, STORAGE_KEY, type LanguageEnvironment } from './language';

const NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  es: 'Español',
  'pt-BR': 'Português',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  it: 'Italiano',
  pl: 'Polski',
  vi: 'Tiếng Việt',
  th: 'ไทย',
};

const CATALOGUES: Catalogues = catalogueSet(
  Object.entries(NAMES).map(([tag, name]) => parseCatalogue(tag, { '@name': name, '@sameAsEnglish': [] })),
);

/** A `localStorage` held in a map, which can be made to throw on every read or every write. */
class TestStorage implements Storage {
  readonly items = new Map<string, string>();
  throwOnRead = false;
  throwOnWrite = false;

  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    if (this.throwOnRead) {
      throw new DOMException('The storage is blocked.', 'SecurityError');
    }
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.throwOnWrite) {
      throw new DOMException('The storage is blocked.', 'SecurityError');
    }
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    if (this.throwOnWrite) {
      throw new DOMException('The storage is blocked.', 'SecurityError');
    }
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
}

interface Browser extends LanguageEnvironment {
  languages: string[];
  language: string;
  store: TestStorage;
}

function browser(languages: string[], language = languages[0] ?? '', stored?: string): Browser {
  const store = new TestStorage();
  if (stored !== undefined) {
    store.items.set(STORAGE_KEY, stored);
  }
  return { languages, language, store, storage: () => store };
}

function startIn(environment: LanguageEnvironment): string {
  return createLanguageStore(CATALOGUES, environment).getState().current;
}

describe('the current language at start', () => {
  it('the browser\'s languages ["de-AT"] and nothing stored → German', () => {
    expect(startIn(browser(['de-AT']))).toBe('de');
  });

  it.each([
    [['pt-PT'], 'pt-BR'],
    [['es-419'], 'es'],
    [['ko-KR'], 'ko'],
    [['PT-br'], 'pt-BR'],
  ])('%j → %s', (languages, expected) => {
    expect(startIn(browser(languages))).toBe(expected);
  });

  it.each([
    [['fr-CA', 'en'], 'fr'],
    [['zh-CN', 'ja'], 'ja'],
  ])('%j → the first that matches, %s', (languages, expected) => {
    expect(startIn(browser(languages))).toBe(expected);
  });

  it('["zh-CN"] → English', () => {
    expect(startIn(browser(['zh-CN']))).toBe('en');
  });

  it('an empty list and navigator.language "it-IT" → Italian', () => {
    expect(startIn(browser([], 'it-IT'))).toBe('it');
  });

  it('an empty list and an empty navigator.language → English', () => {
    expect(startIn(browser([], ''))).toBe('en');
  });

  it('a stored choice ja and the browser\'s languages ["de-DE"] → Japanese', () => {
    const environment = browser(['de-DE'], 'de-DE', 'ja');
    const store = createLanguageStore(CATALOGUES, environment);
    expect(store.getState()).toEqual({ current: 'ja', choice: 'ja', browser: 'de' });
  });

  it("a stored value xx, not a tag of R1.1 → the browser's language applies and the key is removed", () => {
    const environment = browser(['de-DE'], 'de-DE', 'xx');
    const store = createLanguageStore(CATALOGUES, environment);
    expect(store.getState()).toEqual({ current: 'de', choice: null, browser: 'de' });
    expect(environment.store.items.has(STORAGE_KEY)).toBe(false);
  });

  it("localStorage throwing on every read → the browser's language applies and nothing throws", () => {
    const environment = browser(['de-DE'], 'de-DE', 'ja');
    environment.store.throwOnRead = true;
    expect(startIn(environment)).toBe('de');
  });

  it("localStorage that cannot even be reached → the browser's language applies and nothing throws", () => {
    const environment: LanguageEnvironment = {
      languages: ['fr-FR'],
      language: 'fr-FR',
      storage: () => {
        throw new DOMException('The storage is blocked.', 'SecurityError');
      },
    };
    const store = createLanguageStore(CATALOGUES, environment);
    expect(store.getState().current).toBe('fr');
    expect(() => {
      store.choose('de');
    }).not.toThrow();
    expect(store.getState().current).toBe('de');
  });
});

describe('a choice', () => {
  it('choose German → the stored choice is de; choose "Browser language" → the key is removed and the language is the browser\'s', () => {
    const environment = browser(['fr-FR']);
    const store = createLanguageStore(CATALOGUES, environment);
    store.choose('de');
    expect(environment.store.items.get(STORAGE_KEY)).toBe('de');
    expect(store.getState()).toEqual({ current: 'de', choice: 'de', browser: 'fr' });
    store.choose(null);
    expect(environment.store.items.has(STORAGE_KEY)).toBe(false);
    expect(store.getState()).toEqual({ current: 'fr', choice: null, browser: 'fr' });
  });

  it('choose German with localStorage throwing on every write → the current language is German and nothing throws', () => {
    const environment = browser(['fr-FR']);
    environment.store.throwOnWrite = true;
    const store = createLanguageStore(CATALOGUES, environment);
    expect(() => {
      store.choose('de');
    }).not.toThrow();
    expect(store.getState().current).toBe('de');
  });

  it('tells its subscribers once per change, and not for the choice already made', () => {
    const store = createLanguageStore(CATALOGUES, browser(['en-US']));
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getState().current));
    store.choose('de');
    store.choose('de');
    store.choose('fr');
    expect(seen).toEqual(['de', 'fr']);
  });

  it('a tag Studio has no catalogue for → nothing changes', () => {
    const environment = browser(['en-US']);
    const store = createLanguageStore(CATALOGUES, environment);
    const before = store.getState();
    store.choose('zh');
    expect(store.getState()).toBe(before);
    expect(environment.store.items.has(STORAGE_KEY)).toBe(false);
  });
});

describe("the browser's languages after start", () => {
  it('change after start → the current language stays until the next start (R2.3)', () => {
    const environment = browser(['de-DE']);
    const store = createLanguageStore(CATALOGUES, environment);
    environment.languages.splice(0, 1, 'fr-FR');
    environment.language = 'fr-FR';
    expect(store.getState().current).toBe('de');
    store.choose('it');
    store.choose(null);
    expect(store.getState().current).toBe('de');
    expect(startIn(environment)).toBe('fr');
  });
});
