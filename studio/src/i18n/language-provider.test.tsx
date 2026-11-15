// The context of the current language and its hook (requirement R2.6, R5.1), on test catalogues.

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogueSet, parseCatalogue } from './catalogue';
import { createLanguageStore, STORAGE_KEY, type LanguageEnvironment } from './language';
import { useLanguage } from './language-context';
import { LanguageProvider } from './language-provider';

const CATALOGUES = catalogueSet([
  parseCatalogue('en', { '@name': 'English', greeting: 'Hello' }),
  parseCatalogue('de', { '@name': 'Deutsch', greeting: 'Hallo' }),
]);

function environment(languages: string[]): LanguageEnvironment {
  return { languages, language: languages[0] ?? '', storage: () => window.localStorage };
}

function Greeting() {
  const { t, tag, languages } = useLanguage<'greeting'>();
  return (
    <p data-tag={tag} data-languages={languages.map((language) => `${language.tag}:${language.name}`).join(' ')}>
      {t('greeting')}
    </p>
  );
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = 'en';
});

describe('LanguageProvider', () => {
  it("gives the current language's text and tag, and every language with its own name", () => {
    const store = createLanguageStore(CATALOGUES, environment(['de-CH']));
    render(
      <LanguageProvider store={store}>
        <Greeting />
      </LanguageProvider>,
    );
    const greeting = screen.getByText('Hallo');
    expect(greeting.dataset['tag']).toBe('de');
    expect(greeting.dataset['languages']).toBe('de:Deutsch en:English');
    expect(document.documentElement.lang).toBe('de');
  });

  it('a choice → the text and <html lang> change at once, on the same element, and the choice is stored', () => {
    const store = createLanguageStore(CATALOGUES, environment(['en-US']));
    render(
      <LanguageProvider store={store}>
        <Greeting />
      </LanguageProvider>,
    );
    const greeting = screen.getByText('Hello');
    act(() => {
      store.choose('de');
    });
    expect(greeting).toHaveTextContent('Hallo');
    expect(greeting.isConnected).toBe(true);
    expect(document.documentElement.lang).toBe('de');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('de');
  });

  it("with no store given → one resolved from the browser over Studio's bundled catalogues", () => {
    function Tag() {
      return <p>{useLanguage().tag}</p>;
    }
    document.documentElement.lang = '';
    render(
      <LanguageProvider>
        <Tag />
      </LanguageProvider>,
    );
    expect(screen.getByText('en')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('useLanguage outside a LanguageProvider → an error that says so', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Greeting />)).toThrow(/LanguageProvider/);
  });
});
