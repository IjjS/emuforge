// The catalogue check (requirement R4.7, R1.4) on test catalogues: each rule fails on the catalogue that breaks it,
// names the key, and passes once the catalogue keeps it.

import { describe, expect, it } from 'vitest';

import { parseCatalogue, type Catalogue } from './catalogue';
import { catalogueProblems, holdsTerm, parseGlossary } from './catalogue-check';

const ENGLISH = parseCatalogue('en', {
  '@name': 'English',
  '@sameAsEnglish': [],
  'home.title': 'Home',
  'notice.port': 'No emulator is running on port {port}.',
  'home.services': { one: '{count} service', other: '{count} services' },
  'engine.state': 'The engine answered.',
  'copy.label': 'Copy commands',
});

const GLOSSARY = parseGlossary({
  engine: { forms: ['engine', 'engines'], exempt: [], stems: { ru: 'движ', de: 'Engine' } },
  command: { forms: ['command', 'commands'], exempt: [], stems: { ru: 'команд', de: 'Befehl' } },
  Home: { forms: ['Home'], exempt: [], stems: { ru: 'Главн', de: 'Start' } },
  port: { forms: ['port', 'ports'], exempt: ['notice.port'], stems: { ru: 'порт', de: 'Port' } },
});

/** A Russian catalogue that passes; `change` replaces entries, an `undefined` value removes one. */
function russian(change: Record<string, unknown> = {}): Catalogue {
  const entries: Record<string, unknown> = {
    '@name': 'Русский',
    '@sameAsEnglish': [],
    'home.title': 'Главная',
    'notice.port': 'Эмулятор не запущен на {port}.',
    'home.services': {
      one: '{count} сервис',
      few: '{count} сервиса',
      many: '{count} сервисов',
      other: '{count} сервиса',
    },
    'engine.state': 'Ответ движка получен.',
    'copy.label': 'Копировать команды',
    ...change,
  };
  return parseCatalogue('ru', Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)));
}

function problems(catalogue: Catalogue): string[] {
  return catalogueProblems(ENGLISH, catalogue, GLOSSARY);
}

describe('the catalogue check', () => {
  it('a catalogue that keeps every rule → no problem', () => {
    expect(problems(russian())).toEqual([]);
    expect(problems(ENGLISH)).toEqual([]);
  });

  it('a test catalogue that lacks one key of English → fails and names the key', () => {
    expect(problems(russian({ 'engine.state': undefined }))).toEqual([expect.stringContaining('"engine.state"')]);
  });

  it('a test catalogue with a key English lacks → fails and names it', () => {
    expect(problems(russian({ 'home.extra': 'Лишнее' }))).toEqual([expect.stringContaining('"home.extra"')]);
  });

  it('a message that drops a placeholder of the English message → fails and names the key', () => {
    expect(problems(russian({ 'notice.port': 'Эмулятор не запущен.' }))).toEqual([
      expect.stringContaining('"notice.port"'),
    ]);
  });

  it('a message that renames a placeholder of the English message → fails and names the key', () => {
    expect(problems(russian({ 'notice.port': 'Эмулятор не запущен на {porta}.' }))).toEqual([
      expect.stringContaining('"notice.port"'),
    ]);
    const forms = { one: '{count} сервис', few: '{n} сервиса', many: '{count} сервисов', other: '{count} сервиса' };
    expect(problems(russian({ 'home.services': forms }))).toEqual([expect.stringContaining('"home.services"')]);
  });

  it("a Russian counted message that lacks few → fails; the categories are Intl.PluralRules' in this runtime", () => {
    expect(new Intl.PluralRules('ru').resolvedOptions().pluralCategories).toContain('few');
    const forms = { one: '{count} сервис', many: '{count} сервисов', other: '{count} сервиса' };
    expect(problems(russian({ 'home.services': forms }))).toEqual([expect.stringMatching(/"home\.services".*"few"/)]);
  });

  it('a counted message of English given as a single text → fails and names the key', () => {
    expect(problems(russian({ 'home.services': '{count} сервисов' }))).toEqual([
      expect.stringContaining('"home.services"'),
    ]);
  });

  it('a value identical to English → fails; the same value with its key listed as the same as English → passes', () => {
    expect(problems(russian({ 'engine.state': 'The engine answered.' }))).toEqual([
      expect.stringMatching(/"engine\.state" is the same as English/),
      // The copied English text lacks the stem as well.
      expect.stringMatching(/"engine\.state".*"движ"/),
    ]);
    const copied = russian({ 'home.title': 'Home' });
    expect(problems(copied)).toContainEqual(expect.stringMatching(/"home\.title" is the same as English/));
    expect(
      problems(russian({ 'home.title': 'Home', '@sameAsEnglish': ['home.title'] })).filter((p) =>
        p.includes('the same as English'),
      ),
    ).toEqual([]);
  });

  it('a same-as-English list naming a key English lacks → fails and names it', () => {
    expect(problems(russian({ '@sameAsEnglish': ['home.gone'] }))).toEqual([expect.stringContaining('"home.gone"')]);
  });
});

describe('the glossary rule', () => {
  it('a message whose English holds "engine" and whose translation lacks its stem → fails and names the key', () => {
    expect(problems(russian({ 'engine.state': 'Ответ сервера получен.' }))).toEqual([
      expect.stringMatching(/"engine\.state".*"engine".*"движ"/),
    ]);
  });

  it('the stem in an inflected form (Russian движ in "движка") → passes', () => {
    expect(problems(russian({ 'engine.state': 'Ответ движка получен.' }))).toEqual([]);
    expect(problems(russian({ 'engine.state': 'Движок ответил.' }))).toEqual([]);
  });

  it('"Copy commands" → the form "commands" of "command" is found and its stem is asked for', () => {
    expect(holdsTerm('Copy commands', ['command', 'commands'])).toBe(true);
    expect(problems(russian({ 'copy.label': 'Копировать всё' }))).toEqual([
      expect.stringMatching(/"copy\.label".*"command"/),
    ]);
  });

  it('a message key listed as exempt for a term → not checked for it', () => {
    const catalogue = russian({ 'notice.port': 'Эмулятор не запущен ({port}).' });
    expect(problems(catalogue)).toEqual([]);
    const notExempt = parseGlossary({ port: { forms: ['port', 'ports'], exempt: [], stems: { ru: 'порт' } } });
    expect(catalogueProblems(ENGLISH, catalogue, notExempt)).toEqual([expect.stringMatching(/"notice\.port".*"port"/)]);
  });

  it('a language the glossary gives no stem for → fails and names the term', () => {
    const french = parseCatalogue('fr', {
      '@name': 'Français',
      'home.title': 'Accueil',
      'notice.port': "Aucun émulateur n'est lancé sur le port {port}.",
      'home.services': { one: '{count} service', many: '{count} de services', other: '{count} services' },
      'engine.state': 'Le moteur a répondu.',
      'copy.label': 'Copier les commandes',
      '@sameAsEnglish': ['home.services'],
    });
    expect(problems(french)).toEqual([
      expect.stringMatching(/the glossary gives no stem of "Home"/),
      expect.stringMatching(/the glossary gives no stem of "engine"/),
      expect.stringMatching(/the glossary gives no stem of "command"/),
    ]);
  });

  it.each([
    ['the engine last reported', 'port'],
    ['Build the `aws-emulator` image', 'emulator'],
    ['`--emulator-port {port}`', 'port'],
    ['`--emulator-port {port}`', 'emulator'],
  ])('the whole-word rule: %j → "%s" is not found', (text, term) => {
    expect(holdsTerm(text, [term, `${term}s`])).toBe(false);
  });

  it.each([
    ['No emulator is running on port {port}.', 'port'],
    ['The Engine answered.', 'engine'],
    ['Ports: {list}', 'port'],
    ['Go to Home', 'Home'],
  ])('the whole-word rule: %j → "%s" is found, whatever its case', (text, term) => {
    expect(holdsTerm(text, [term, `${term}s`])).toBe(true);
  });
});
