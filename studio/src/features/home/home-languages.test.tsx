// Home and the frame in every language (requirement R4.1, R4.3, R4.9): with a marked test catalogue, every text of
// Studio's own layer comes from a catalogue; in every language the engine's message is shown as it was sent, marked
// as English.

import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_CATALOGUES } from '../../i18n/bundled';
import {
  advance,
  buildOnceToggle,
  connected,
  connectionNotice,
  copyButtonsIn,
  emulatorDown,
  engineRefusal,
  FakeEngine,
  languageStore,
  MARK_CLOSE,
  MARK_OPEN,
  MARKED_TAG,
  present,
  renderApp,
  unmarkedText,
  type FakeAnswer,
} from '../../test/home-test-kit';

/** The AWS area's first import is real work (Cloudscape's modules), not a timer; a cold run takes a while. */
const AREA_LOAD = { timeout: 10_000, interval: 20 };
const AREA_TEST_MS = 20_000;

/** A message the engine sends: English, and never translated. */
const MESSAGE = 'nothing answers on https://127.0.0.1:9297; the emulator for port 9297 is not running';

/** One state of Home (R4.9): the engine's answers, what a user does after the first answer, the messages sent. */
interface HomeState {
  name: string;
  answers: FakeAnswer[];
  then?: () => Promise<void>;
  engineMessages: string[];
}

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await advance();
}

/** Gives the page a clipboard that takes every write, or refuses every write. */
function clipboard(works: boolean) {
  const writeText = vi.fn(() => (works ? Promise.resolve() : Promise.reject(new Error('refused'))));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

async function copyFirstCommand() {
  await click(present(copyButtonsIn(connectionNotice())[0], 'a copy button'));
}

const HOME_STATES: HomeState[] = [
  { name: 'checking', answers: [{ hang: true }], engineMessages: [] },
  { name: 'connected', answers: [connected()], engineMessages: [] },
  { name: 'emulator not started', answers: [emulatorDown('not_started', 9297, MESSAGE)], engineMessages: [] },
  ...['connection_refused', 'tls_untrusted', 'files_unreadable', 'timeout'].map((reason): HomeState => ({
    name: `emulator unreachable, ${reason}`,
    answers: [emulatorDown(reason, 9297, MESSAGE)],
    engineMessages: [MESSAGE],
  })),
  { name: 'an unknown reason', answers: [emulatorDown('something_new', 9297, MESSAGE)], engineMessages: [MESSAGE] },
  {
    name: 'emulator unreachable with an empty engine message',
    answers: [emulatorDown('connection_refused', 9297, '')],
    engineMessages: [],
  },
  { name: 'engine unreachable, no emulator port known', answers: [{ network: true }], engineMessages: [] },
  {
    name: 'engine unreachable after an answer reported port 9393',
    answers: [connected(9393), { network: true }],
    then: () => advance(5_000),
    engineMessages: [],
  },
  {
    name: 'engine error with a code and a message',
    answers: [engineRefusal(503, 'Busy', MESSAGE)],
    engineMessages: [MESSAGE],
  },
  {
    name: 'engine error with a code and no message',
    answers: [{ status: 503, json: { error: { code: 'Busy' } } }],
    engineMessages: [],
  },
  {
    name: 'engine error without a code, 2xx, with a message',
    answers: [{ status: 200, json: { error: { message: MESSAGE } } }],
    engineMessages: [MESSAGE],
  },
  { name: 'engine error without a code, 2xx, no message', answers: [{ status: 200, json: {} }], engineMessages: [] },
  {
    name: 'engine error without a code, 500, with a message',
    answers: [{ status: 500, json: { error: { message: MESSAGE } } }],
    engineMessages: [MESSAGE],
  },
  { name: 'engine error without a code, 500, no message', answers: [{ status: 500 }], engineMessages: [] },
  {
    name: 'build-once open',
    answers: [emulatorDown('not_started', 9297, MESSAGE)],
    then: () => click(present(buildOnceToggle(), 'the build-once toggle')),
    engineMessages: [],
  },
  {
    name: 'a copy done',
    answers: [emulatorDown('timeout', 9297, MESSAGE)],
    then: () => {
      clipboard(true);
      return copyFirstCommand();
    },
    engineMessages: [MESSAGE],
  },
  {
    name: 'a copy failed',
    answers: [emulatorDown('timeout', 9297, MESSAGE)],
    then: () => {
      clipboard(false);
      return copyFirstCommand();
    },
    engineMessages: [MESSAGE],
  },
];

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  // The AWS area follows the operating system's scheme, which jsdom does not report: light here.
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
  document.documentElement.lang = 'en';
  document.title = '';
});

/** Opens Home in `tag` in state `state`, and lets what the state needs happen. */
async function openHomeIn(tag: string, state: HomeState) {
  engine.healthAnswers = state.answers;
  renderApp('/', languageStore(tag));
  await advance();
  await state.then?.();
}

describe('Home and the frame with a marked test catalogue: no text written in a component (R4.1)', () => {
  it.each(HOME_STATES.map((state) => [state.name, state] as const))(
    '%s: every text of Studio is marked or kept as it is',
    async (_name, state) => {
      await openHomeIn(MARKED_TAG, state);
      // The page is in the marked catalogue, so the check below is not vacuous.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${MARK_OPEN}Home${MARK_CLOSE}`);
      expect(unmarkedText({ engineMessages: state.engineMessages })).toEqual([]);
    },
  );

  it('the same check on Home in English finds its English text, so it would find an inline string', async () => {
    await openHomeIn('en', present(HOME_STATES[2], 'not started'));
    const found = unmarkedText();
    expect(found).toContainEqual(expect.stringContaining('"Skip to content"'));
    expect(found).toContainEqual(expect.stringContaining('"No emulator is running on port 9297"'));
    expect(found).toContainEqual(expect.stringContaining('aria-label "Studio"'));
  });

  it('Studio\'s "Page not found" with a short path: every text of Studio is marked or kept as it is', async () => {
    renderApp('/does-not-exist', languageStore(MARKED_TAG));
    await advance();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${MARK_OPEN}Page not found${MARK_CLOSE}`);
    expect(document.title).toBe(`${MARK_OPEN}Page not found${MARK_CLOSE} | EmuForge Studio`);
    expect(unmarkedText()).toEqual([]);
  });

  it('Studio\'s "Page not found" with an over-long path: the path\'s region and every text are marked', async () => {
    // jsdom lays nothing out: the path box reports a width beyond its own, as an over-long path does.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'CODE' ? 4_000 : 0;
    });
    renderApp(`/${'a-very-long-segment-of-a-path/'.repeat(12)}end`, languageStore(MARKED_TAG));
    await advance();
    expect(screen.getByRole('region', { name: `${MARK_OPEN}Path${MARK_CLOSE}` })).toBeInTheDocument();
    expect(unmarkedText()).toEqual([]);
  });

  it(
    'the frame on an AWS area page: every text of Studio outside the area is marked or kept as it is',
    async () => {
      renderApp('/aws/s3', languageStore(MARKED_TAG));
      await vi.waitFor(async () => {
        await advance();
        expect(screen.getByRole('heading', { level: 1, name: 'Amazon Simple Storage Service' })).toBeInTheDocument();
      }, AREA_LOAD);
      const studio = screen.getByRole('navigation', { name: `${MARK_OPEN}Studio${MARK_CLOSE}` });
      expect(within(studio).getByRole('link', { name: 'AWS' })).toBeInTheDocument();
      expect(document.title).toBe('Amazon Simple Storage Service | EmuForge Studio');
      expect(unmarkedText()).toEqual([]);
    },
    AREA_TEST_MS,
  );
});

/** The tags of every bundled catalogue, and the marked test catalogue's. */
const LANGUAGES = [...BUNDLED_CATALOGUES.byTag.keys(), MARKED_TAG];

/** The states whose notice shows the engine's message. */
const WITH_MESSAGE = HOME_STATES.filter((state) => state.engineMessages.length > 0 && state.then === undefined);

describe("the engine's message in every language (R4.3)", () => {
  it.each(LANGUAGES.flatMap((tag) => WITH_MESSAGE.map((state) => [tag, state.name, state] as const)))(
    '%s, %s: shown as sent, in an element with lang="en"',
    async (tag, _name, state) => {
      await openHomeIn(tag, state);
      const shown = within(connectionNotice()).getByText(MESSAGE);
      expect(shown).toHaveTextContent(MESSAGE, { normalizeWhitespace: false });
      const marked = present(shown.closest('[lang]'), 'an element with lang around the message');
      expect(marked).not.toBe(document.documentElement);
      expect(marked).toHaveAttribute('lang', 'en');
      expect(marked.textContent).toBe(MESSAGE);
    },
  );
});
