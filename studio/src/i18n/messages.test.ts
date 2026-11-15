// The message function (requirement R4.4, R4.5, R4.8) on test catalogues: placeholders filled with text or elements,
// counted messages by the plural rules of their language, and English or `other` where a catalogue lacks a text.

import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { catalogueSet, parseCatalogue, type Catalogues } from './catalogue';
import { formatNumber } from './format';
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
