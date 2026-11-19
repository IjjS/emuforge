// The message function (requirement R4.4, R4.5, R4.8) on test catalogues: placeholders filled with text or elements,
// counted messages by the plural rules of their language, and English or `other` where a catalogue lacks a text.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { LanguageControl } from '../ui/language-control';
import { BUNDLED_CATALOGUES } from './bundled';
import { catalogueSet, parseCatalogue, textsOf, type Catalogues } from './catalogue';
import { formatNumber } from './format';
import { createLanguageStore, STORAGE_KEY } from './language';
import { useLanguage } from './language-context';
import { LanguageProvider } from './language-provider';
import { messagesFor } from './messages';

const STATEMENT = 'lost.statement';
const SERVICES = 'home.services';

/** The forms of the services line in `tag`: each names its category, so the test sees which one was chosen. */
function servicesForms(tag: string, categories: readonly string[]): Record<string, string> {
  return Object.fromEntries(categories.map((category) => [category, `{count} ${tag}-${category}`]));
}

const CATALOGUES: Catalogues = catalogueSet([
  parseCatalogue('en', {
    '@name': 'English',
    [STATEMENT]: 'Studio has no page at {path}.',
    [SERVICES]: { one: '{count} service · no Studio screen yet', other: '{count} services · no Studio screen yet' },
    'only.english': 'Only in English',
    'empty.here': 'English, since the other is empty',
  }),
  parseCatalogue('ko', {
    '@name': '한국어',
    [STATEMENT]: '{path}에 해당하는 Studio 페이지가 없습니다.',
  }),
  parseCatalogue('ja', {
    '@name': '日本語',
    [STATEMENT]: 'Studio には {path} というページがありません。',
    [SERVICES]: servicesForms('ja', ['other']),
  }),
  parseCatalogue('ru', {
    '@name': 'Русский',
    [SERVICES]: servicesForms('ru', ['one', 'few', 'many', 'other']),
  }),
  parseCatalogue('pl', {
    '@name': 'Polski',
    [SERVICES]: servicesForms('pl', ['one', 'few', 'many', 'other']),
  }),
  parseCatalogue('fr', {
    '@name': 'Français',
    [SERVICES]: servicesForms('fr', ['one', 'many', 'other']),
    'empty.here': '',
  }),
  // A Russian catalogue as a browser whose plural data has fewer categories than the check's would accept it.
  parseCatalogue('uk', {
    '@name': 'Українська',
    [SERVICES]: { other: '{count} uk-other' },
  }),
]);

/** The path box of Studio's "Page not found". */
function pathBox(path: string) {
  return createElement('code', null, path);
}

describe('placeholders', () => {
  it.each([
    ['ko', ['CODE', '#text']],
    ['ja', ['#text', 'CODE', '#text']],
  ])(
    'the "Page not found" statement with the path box in %s → the element stands where the placeholder stands',
    (tag, nodes) => {
      const { t } = messagesFor<string>(CATALOGUES, tag);
      const { container } = render(createElement('p', null, t(STATEMENT, { path: pathBox('/nowhere') })));
      const paragraph = container.querySelector('p');
      expect(Array.from(paragraph?.childNodes ?? [], (node) => node.nodeName)).toEqual(nodes);
      expect(paragraph?.querySelector('code')?.textContent).toBe('/nowhere');
      expect(paragraph?.textContent).toBe(
        tag === 'ko'
          ? '/nowhere에 해당하는 Studio 페이지가 없습니다.'
          : 'Studio には /nowhere というページがありません。',
      );
    },
  );

  it('a placeholder value <img src=x onerror=alert(1)> → shown as that text; no element is created from it', () => {
    const value = '<img src=x onerror=alert(1)>';
    const { t } = messagesFor<string>(CATALOGUES, 'en');
    expect(t(STATEMENT, { path: value })).toBe(`Studio has no page at ${value}.`);
    const { container } = render(createElement('p', null, t(STATEMENT, { path: value })));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('p')?.childElementCount).toBe(0);
    expect(container.textContent).toBe(`Studio has no page at ${value}.`);
    const withElement = render(createElement('p', null, t(STATEMENT, { path: pathBox(value) })));
    expect(withElement.container.querySelector('img')).toBeNull();
    expect(withElement.container.querySelector('code')?.textContent).toBe(value);
  });

  it('a placeholder given no value → an error, never the placeholder shown', () => {
    const { t } = messagesFor<string>(CATALOGUES, 'en');
    expect(() => t(STATEMENT)).toThrow(/\{path\}/);
  });
});

describe('counted messages', () => {
  const COUNTS = [0, 1, 2, 5, 21, 22];

  it.each(['en', 'ru', 'pl', 'fr', 'ja'])(
    'the services line for 0, 1, 2, 5, 21 and 22 in %s → the form of the category Intl.PluralRules gives',
    (tag) => {
      const { plural } = messagesFor<string>(CATALOGUES, tag);
      const rules = new Intl.PluralRules(tag);
      for (const count of COUNTS) {
        const category = rules.select(count);
        const expected =
          tag === 'en'
            ? `${String(count)} ${category === 'one' ? 'service' : 'services'} · no Studio screen yet`
            : `${String(count)} ${tag}-${category}`;
        expect(plural(SERVICES, count), `${tag} ${String(count)}`).toBe(expected);
      }
    },
  );

  it('Russian 1, 2, 5, 21, 22 → one, few, many, one, few', () => {
    const { plural } = messagesFor<string>(CATALOGUES, 'ru');
    expect([1, 2, 5, 21, 22].map((count) => plural(SERVICES, count))).toEqual([
      '1 ru-one',
      '2 ru-few',
      '5 ru-many',
      '21 ru-one',
      '22 ru-few',
    ]);
  });

  it('the count is a number of the language', () => {
    const { plural } = messagesFor<string>(CATALOGUES, 'pl');
    expect(plural(SERVICES, 12345)).toBe(`${formatNumber('pl', 12345)} pl-many`);
  });
});

describe('a counted message with U+00A0 after the count (issue 32, R4.1)', () => {
  const JOINED: Catalogues = catalogueSet([
    parseCatalogue('en', {
      '@name': 'English',
      [SERVICES]: {
        one: '{count}\u00a0service · no Studio screen yet',
        other: '{count}\u00a0services · no Studio screen yet',
      },
    }),
    parseCatalogue('de', {
      '@name': 'Deutsch',
      [SERVICES]: {
        one: '{count}\u00a0Dienst · noch keine Studio-Ansicht',
        other: '{count}\u00a0Dienste · noch keine Studio-Ansicht',
      },
    }),
  ]);

  it.each([
    ['en', 19, 'services · no Studio screen yet'],
    ['en', 12345, 'services · no Studio screen yet'],
    ['de', 5, 'Dienste · noch keine Studio-Ansicht'],
    ['de', 12345, 'Dienste · noch keine Studio-Ansicht'],
  ])(
    '%s, count %d → the formatted count, then U+00A0, then the unit, no ordinary space between them',
    (tag, count, rest) => {
      const formatted = formatNumber(tag, count);
      const text = messagesFor<string>(JOINED, tag).plural(SERVICES, count);
      expect(text).toBe(`${formatted}\u00a0${rest}`);
      // The count, the no-break space and the unit up to the next space: no ordinary space among them.
      expect(text.slice(0, formatted.length + 1 + rest.indexOf(' '))).not.toContain(' ');
    },
  );
});

describe("Home's providers line in Studio's English catalogue (issue 494, R2)", () => {
  const { plural } = messagesFor(BUNDLED_CATALOGUES, 'en');

  it('providers.servicesWithScreens, counts 1 and 19 with 4 screens → the services, then how many have a Studio screen, a no-break space after the first number', () => {
    expect(plural('providers.servicesWithScreens', 1, { screens: '4' })).toBe(
      '1\u00a0service · 4 with a Studio screen',
    );
    expect(plural('providers.servicesWithScreens', 19, { screens: '4' })).toBe(
      '19\u00a0services · 4 with a Studio screen',
    );
  });

  it('providers.services → reads as before', () => {
    expect(plural('providers.services', 1)).toBe('1\u00a0service · no Studio screen yet');
    expect(plural('providers.services', 19)).toBe('19\u00a0services · no Studio screen yet');
  });
});

describe('a catalogue that lacks a text', () => {
  it('a message missing from the current catalogue → the English text; never the key, never an empty text', () => {
    expect(messagesFor<string>(CATALOGUES, 'ko').t('only.english')).toBe('Only in English');
    expect(messagesFor<string>(CATALOGUES, 'fr').t('empty.here')).toBe('English, since the other is empty');
    expect(messagesFor<string>(CATALOGUES, 'ko').plural(SERVICES, 2)).toBe('2 services · no Studio screen yet');
  });

  it("a plural category the runtime asks for that the catalogue lacks → the language's other form, not English", () => {
    const { plural } = messagesFor<string>(CATALOGUES, 'uk');
    expect(new Intl.PluralRules('uk').select(1)).toBe('one');
    expect(plural(SERVICES, 1)).toBe('1 uk-other');
    expect(plural(SERVICES, 3)).toBe('3 uk-other');
  });

  it('a key English does not have either → an error, never the key shown', () => {
    expect(() => messagesFor<string>(CATALOGUES, 'ko').t('no.such.key')).toThrow(/no\.such\.key/);
  });
});

/** A test catalogue for Ukrainian, a language Studio does not have: every English message marked `uk:`. */
function ukrainian() {
  const json: Record<string, unknown> = { '@name': 'Українська' };
  for (const [key, message] of BUNDLED_CATALOGUES.source.messages) {
    json[key] =
      typeof message === 'string'
        ? `uk:${message}`
        : Object.fromEntries(Object.entries(message).map(([category, text]) => [category, `uk:${text}`]));
  }
  return parseCatalogue('uk', json);
}

/** A text of Studio's that reads the current language, beside the control. */
function HomeLink() {
  const { t } = useLanguage();
  return createElement('p', null, t('frame.home'));
}

describe('a further language (R4.6)', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('a test catalogue added for a further language → offered by the control and, once chosen, shown, with no other change', async () => {
    const catalogues = catalogueSet([...BUNDLED_CATALOGUES.byTag.values(), ukrainian()]);
    expect(textsOf(catalogues.byTag.get('uk')?.messages.get('frame.home') ?? '')).toEqual(['uk:Home']);
    const store = createLanguageStore(catalogues, {
      languages: ['en-US'],
      language: 'en-US',
      storage: () => window.localStorage,
    });
    render(
      createElement(LanguageProvider, {
        store,
        children: createElement(Fragment, null, createElement(LanguageControl), createElement(HomeLink)),
      }),
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Language: English' }));
    const offered = within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Українська' });
    expect(offered).toHaveAttribute('lang', 'uk');
    await user.click(offered);

    expect(screen.getByText('uk:Home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'uk:Language: Українська' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('uk');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('uk');
  });
});
