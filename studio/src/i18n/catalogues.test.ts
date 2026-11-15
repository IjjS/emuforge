// The catalogue check (requirement R4.7, R1.4) on test catalogues: each rule fails on the catalogue that breaks it,
// names the key, and passes once the catalogue keeps it. And no screen code names a language (R4.6).

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { BUNDLED_CATALOGUES } from './bundled';
import { parseCatalogue, type Catalogue } from './catalogue';
import { catalogueProblems, GLOSSARY as STUDIO_GLOSSARY, holdsTerm, parseGlossary } from './catalogue-check';

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

/** The tags of requirement R1.1. */
const TAGS = ['en', 'ko', 'ja', 'es', 'pt-BR', 'fr', 'de', 'ru', 'it', 'pl', 'vi', 'th'];

/** The languages of R1.1 and their own names. */
const OWN_NAMES: Readonly<Record<string, string>> = {
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

describe("Studio's catalogues (R1.1, R4.6, R4.7)", () => {
  it('the catalogue files → exactly twelve, named by the tags of R1.1, each with its own name', () => {
    const files = [...BUNDLED_CATALOGUES.byTag.values()];
    expect(files.map((catalogue) => catalogue.tag).sort()).toEqual([...TAGS].sort());
    expect(Object.fromEntries(files.map((catalogue) => [catalogue.tag, catalogue.name]))).toEqual(OWN_NAMES);
  });

  it.each(TAGS)('the catalogue %s on the branch → passes every rule of the check', (tag) => {
    const catalogue = BUNDLED_CATALOGUES.byTag.get(tag);
    expect(catalogue).toBeDefined();
    expect(catalogueProblems(BUNDLED_CATALOGUES.source, catalogue as Catalogue)).toEqual([]);
  });

  it('the glossary → a stem for every term in each of the eleven languages other than English', () => {
    const others = TAGS.filter((tag) => tag !== 'en');
    expect(STUDIO_GLOSSARY.map((term) => term.term).sort()).toEqual(
      ['Home', 'Refresh', 'Studio', 'command', 'emulator', 'engine', 'port'].sort(),
    );
    for (const term of STUDIO_GLOSSARY) {
      expect([term.term, [...term.stems.keys()].sort()]).toEqual([term.term, [...others].sort()]);
    }
  });
});

/** The source of every file of Studio's own screens, tests aside: `app/`, `ui/` and `features/`. */
const SCREEN_CODE = import.meta.glob<string>(
  ['../app/**/*.{ts,tsx}', '../ui/**/*.{ts,tsx}', '../features/**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'],
  { eager: true, query: '?raw', import: 'default' },
);

/**
 * Each string literal, template without a placeholder or JSX text of `source` whose text is a tag of R1.1 (ignoring
 * case), with its line; the value `en` of a `lang` attribute written `lang="en"` aside (R4.3). Which elements carry
 * `lang="en"` is not read here: that only the engine's message and an area page title do is the run-time line of
 * `home-languages.test.tsx` (every element whose `lang` differs from the page's).
 */
function tagLiterals(file: string, source: string): string[] {
  const tags = new Set(TAGS.map((tag) => tag.toLowerCase()));
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text;
    } else if (ts.isJsxText(node)) {
      text = node.text.trim();
    }
    if (text !== undefined && tags.has(text.toLowerCase())) {
      const parent = node.parent;
      const englishLang =
        text === 'en' && ts.isStringLiteral(node) && ts.isJsxAttribute(parent) && parent.name.getText() === 'lang';
      if (!englishLang) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${file}:${String(line + 1)} "${text}"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe('screen code and languages (R4.6)', () => {
  it('no file under app/, ui/ or features/ holds a language tag of R1.1, other than lang="en"', () => {
    expect(Object.keys(SCREEN_CODE).length).toBeGreaterThan(10);
    expect(Object.entries(SCREEN_CODE).flatMap(([file, source]) => tagLiterals(file, source))).toEqual([]);
  });

  it.each([
    ["const tag = 'de';", '"de"'],
    ['const tag = "pt-br";', '"pt-br"'],
    ['const tag = `th`;', '"th"'],
    ['export const A = () => <p lang="ja">日本語</p>;', '"ja"'],
    ["export const A = () => <p lang={'en'}>x</p>;", '"en"'],
    ['export const A = () => <p data-tag="en">x</p>;', '"en"'],
    ['export const A = () => <p>ko</p>;', '"ko"'],
  ])('the rule finds %s', (source, literal) => {
    expect(tagLiterals('x.tsx', source)).toEqual([`x.tsx:1 ${literal}`]);
  });

  it('the rule passes lang="en" and text that only holds a tag', () => {
    expect(tagLiterals('x.tsx', 'export const A = () => <span lang="en">{message}</span>;')).toEqual([]);
    expect(tagLiterals('x.tsx', "const a = 'den'; const b = 'English'; const c = `${tag}-x`;")).toEqual([]);
  });
});
