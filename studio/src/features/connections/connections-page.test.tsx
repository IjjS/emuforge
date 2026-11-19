import { fireEvent, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../../app/routes';
import { BUNDLED_CATALOGUES } from '../../i18n/bundled';
import type { MessageKey } from '../../i18n/catalogue';
import {
  advance,
  connectedTo,
  FakeEngine,
  present,
  renderWithTargetSeen,
  targetInfo,
  targetsList,
  targetsRefusal,
  targetTest,
  type FakeAnswer,
  type FakeTarget,
} from '../../test/home-test-kit';

const LOCAL: FakeTarget = { name: 'local', endpoint: 'https://127.0.0.1:9301' };
const SECOND: FakeTarget = { name: 'second', endpoint: 'https://127.0.0.1:9302' };

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  engine.targets = [LOCAL, SECOND];
  engine.active = 'local';
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Opens `/connections` with the app's routes and providers, and lets what it starts on load complete. */
async function openPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/connections'] });
  const view = renderWithTargetSeen(<RouterProvider router={router} />);
  await advance();
  return view;
}

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await advance();
}

/** The row of the connection `name`. */
function rowOf(name: string): HTMLElement {
  const rows = [...document.querySelectorAll<HTMLElement>('li.st-record')];
  return present(
    rows.find((row) => row.querySelector('code')?.textContent === name),
    `the row of ${name}`,
  );
}

function rowNames(): string[] {
  return [...document.querySelectorAll('li.st-record')].map((row) => row.querySelector('code')?.textContent ?? '');
}

/** The value of the field `label` in `row`, as text. */
function field(row: HTMLElement, label: string): string {
  const term = within(row).getByText(label, { selector: 'dt' });
  return spaced(term.nextElementSibling);
}

function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The text of `element`'s blocks and runs, a space between each text node, as a reader meets them. */
function spaced(element: Element | null | undefined): string {
  if (element === null || element === undefined) {
    return '';
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    parts.push(node.textContent ?? '');
  }
  return norm(parts.join(' '));
}

/** The page's result line. */
function resultLine(): HTMLElement {
  return present(document.querySelector<HTMLElement>('.st-result'), 'the result line');
}

function button(name: string, scope: HTMLElement = document.body): HTMLElement {
  return within(scope).getByRole('button', { name });
}

function isBusy(element: HTMLElement): boolean {
  return element.getAttribute('aria-busy') === 'true' && element.getAttribute('aria-disabled') === 'true';
}

/** Records every text a polite region takes, from now: each change of its content is one announcement. */
function recordAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver((records) => {
    const changed = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const region = target?.closest('[aria-live="polite"]');
      if (region) {
        changed.add(region);
      }
    }
    for (const region of changed) {
      const text = norm(region.textContent);
      if (text !== '') {
        said.push(text);
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return said;
}

function infoDelayed(target: FakeTarget, active: boolean, delayMs: number, down?: string): FakeAnswer {
  return { ...(targetInfo(target, active, down) as { status: number; json: unknown }), delayMs };
}

function nameInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Name' });
}

function endpointInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Endpoint' });
}

async function add(name: string, endpoint: string) {
  fireEvent.change(nameInput(), { target: { value: name } });
  fireEvent.change(endpointInput(), { target: { value: endpoint } });
  await click(button('Add connection'));
}

describe('the list (R1, R7, R8)', () => {
  it('loading, then local (the target) and second in order, each Checking until its info answers, then its status and keys', async () => {
    engine.answerTargets('list', { ...(targetsList([LOCAL, SECOND], 'local') as object), delayMs: 1000 } as FakeAnswer);
    engine.answerTargets(
      'info',
      infoDelayed(LOCAL, true, 500),
      infoDelayed(SECOND, false, 1500, 'there are no emulator files for port 9302'),
    );
    await openPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading connections');

    await advance(1000);
    expect(rowNames()).toEqual(['local', 'second']);
    expect(field(rowOf('local'), 'Endpoint')).toBe('https://127.0.0.1:9301');
    expect(field(rowOf('second'), 'Endpoint')).toBe('https://127.0.0.1:9302');
    expect(within(rowOf('local')).getByText('Target')).toBeInTheDocument();
    expect(within(rowOf('second')).queryByText('Target')).toBeNull();
    expect(field(rowOf('local'), 'Emulator')).toBe('Checking');
    expect(field(rowOf('second'), 'Emulator')).toBe('Checking');
    expect(screen.getByText(/^Last checked \d\d:\d\d:\d\d\.$/)).toBeInTheDocument();

    await advance(500);
    expect(field(rowOf('local'), 'Emulator')).toBe('Connected');
    expect(norm(within(rowOf('local')).getByText('Keys', { selector: 'dt' }).nextElementSibling?.textContent)).toBe(
      'Keys are read by the engine from ~/.aws/emulator/9301/',
    );
    expect(field(rowOf('second'), 'Emulator')).toBe('Checking');

    await advance(1000);
    expect(field(rowOf('second'), 'Emulator')).toBe('Not started there are no emulator files for port 9302');
    const message = within(rowOf('second')).getByText('there are no emulator files for port 9302');
    expect(message).toHaveAttribute('lang', 'en');
    expect(norm(within(rowOf('second')).getByText('Keys', { selector: 'dt' }).nextElementSibling?.textContent)).toBe(
      'Keys are read by the engine from ~/.aws/emulator/9302/',
    );
  });

  it('six connections → at most 4 info requests in flight at once, started in list order', async () => {
    const six = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((name, index) => ({
      name,
      endpoint: `https://127.0.0.1:${String(9301 + index)}`,
    }));
    engine.targets = six;
    engine.active = 'a1';
    engine.answerTargets('info', ...six.map((target, index) => infoDelayed(target, index === 0, 1000)));
    let inFlight = 0;
    let most = 0;
    const fakeFetch = engine.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const isInfo = /\/__emuforge\/targets\/[^/]+$/.test(String(input)) && (init?.method ?? 'GET') === 'GET';
      if (!isInfo) {
        return fakeFetch(input, init);
      }
      inFlight += 1;
      most = Math.max(most, inFlight);
      return fakeFetch(input, init).finally(() => {
        inFlight -= 1;
      });
    });
    await openPage();

    expect(engine.targetRequests('info').map((request) => request.path)).toEqual(
      ['a1', 'a2', 'a3', 'a4'].map((name) => `/__emuforge/targets/${name}`),
    );
    await advance(1000);
    expect(engine.targetRequests('info').map((request) => request.path)).toEqual(
      six.map((target) => `/__emuforge/targets/${target.name}`),
    );
    await advance(1000);
    expect(most).toBe(4);
    expect(rowNames().map((name) => field(rowOf(name), 'Emulator'))).toEqual(Array(6).fill('Connected'));
  });

  it('an info that fails → that row Not known, the page otherwise shown', async () => {
    engine.answerTargets('info', targetInfo(LOCAL, true), { network: true });
    await openPage();

    expect(field(rowOf('local'), 'Emulator')).toBe('Connected');
    expect(field(rowOf('second'), 'Emulator')).toBe('Not known');
    expect(button('Add connection')).toBeInTheDocument();
  });

  it('the engine not answering the list → its origin and Refresh; Refresh reads the list again', async () => {
    engine.answerTargets('list', { network: true });
    await openPage();

    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('The EmuForge engine at http://127.0.0.1:8297 is not answering.');
    expect(rowNames()).toEqual([]);
    const refreshes = within(main).getAllByRole('button', { name: 'Refresh' });
    expect(refreshes.length).toBeGreaterThan(0);

    await click(refreshes[refreshes.length - 1] as HTMLElement);
    expect(rowNames()).toEqual(['local', 'second']);
  });

  it('an error with a code → "answered with an error: SettingsUnusable" and its message as text', async () => {
    engine.answerTargets('list', targetsRefusal('SettingsUnusable', 'the settings file ~/x is unreadable; fix it'));
    await openPage();

    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('The EmuForge engine answered with an error: SettingsUnusable');
    expect(within(main).getByText('the settings file ~/x is unreadable; fix it')).toHaveAttribute('lang', 'en');
  });

  it('an error without a code → "answered with HTTP status 500"', async () => {
    engine.answerTargets('list', { status: 500, text: 'Internal error' });
    await openPage();

    expect(screen.getByRole('main')).toHaveTextContent('The EmuForge engine answered with HTTP status 500');
  });

  it('the target seen changes by a health answer → the list and its infos are read again', async () => {
    engine.healthAnswers = [connectedTo('local')];
    await openPage();
    const lists = engine.targetRequests('list').length;
    const infos = engine.targetRequests('info').length;

    engine.active = 'second';
    engine.answerHealth(connectedTo('second'));
    await advance(5000);

    expect(engine.targetRequests('list').length).toBe(lists + 1);
    expect(engine.targetRequests('info').length).toBe(infos + 2);
    expect(within(rowOf('second')).getByText('Target')).toBeInTheDocument();
  });
});

describe('make target (R3)', () => {
  it('"Make target" on second → busy "Making target"; 200 → the answer\'s list, second the target, announced once, reported', async () => {
    const { seen } = await openPage();
    engine.answerTargets('use', { ...(targetsList([LOCAL, SECOND], 'second') as object), delayMs: 1000 } as FakeAnswer);
    const said = recordAnnouncements();
    const lists = engine.targetRequests('list').length;
    expect(seen.current.name).toBe('local');

    await click(button('Make second the target'));
    const control = button('Make second the target');
    expect(control).toHaveTextContent('Making target');
    expect(isBusy(control)).toBe(true);

    await advance(1000);
    expect(within(rowOf('second')).getByText('Target')).toBeInTheDocument();
    expect(within(rowOf('local')).queryByText('Target')).toBeNull();
    expect(engine.targetRequests('list').length).toBe(lists);
    const text = "second is now the target. Studio's screens read its emulator.";
    expect(resultLine()).toHaveTextContent(text);
    expect(said.filter((line) => line === text)).toHaveLength(1);
    expect(seen.current.name).toBe('second');
    expect(seen.current.generation).toBe(1);
    expect(within(rowOf('local')).getByRole('button', { name: 'Make local the target' })).toBeInTheDocument();
  });

  it('"Make target" answered 404 → "second is no longer a connection; it was removed elsewhere." and the list read again', async () => {
    await openPage();
    engine.answerTargets('use', targetsRefusal('TargetNotFound'));
    const lists = engine.targetRequests('list').length;

    await click(button('Make second the target'));

    expect(resultLine()).toHaveTextContent('second is no longer a connection; it was removed elsewhere.');
    expect(engine.targetRequests('list').length).toBe(lists + 1);
  });
});

describe('a change with no answer in 5 s (R8)', () => {
  const TEXT = 'The EmuForge engine did not answer in time. The list was read again; check whether second changed.';

  it('"Make target"', async () => {
    await openPage();
    engine.answerTargets('use', { hang: true });
    const lists = engine.targetRequests('list').length;

    await click(button('Make second the target'));
    await advance(4900);
    expect(resultLine()).toHaveTextContent('');
    await advance(100);

    expect(engine.targetRequests('list').length).toBe(lists + 1);
    expect(resultLine()).toHaveTextContent(TEXT);
  });

  it('"Add connection"', async () => {
    engine.targets = [LOCAL];
    await openPage();
    engine.answerTargets('add', { hang: true });
    const lists = engine.targetRequests('list').length;

    await add('second', 'https://127.0.0.1:9302');
    await advance(5000);

    expect(engine.targetRequests('list').length).toBe(lists + 1);
    expect(resultLine()).toHaveTextContent(TEXT);
    expect(nameInput()).toHaveValue('second');
  });

  it('the dialog\'s "Remove"', async () => {
    await openPage();
    engine.answerTargets('remove', { hang: true });
    const lists = engine.targetRequests('list').length;

    await click(button('Remove second'));
    await click(button('Remove', screen.getByRole('dialog')));
    await advance(5000);

    expect(engine.targetRequests('list').length).toBe(lists + 1);
    expect(resultLine()).toHaveTextContent(TEXT);
  });
});

describe('add (R4)', () => {
  it('valid fields → "Adding"; 201 → the list read again, the row, the result line, the form emptied', async () => {
    engine.targets = [LOCAL];
    await openPage();
    const lists = engine.targetRequests('list').length;
    engine.answerTargets('add', {
      status: 201,
      json: { name: 'second', endpoint: SECOND.endpoint, active: false },
      delayMs: 1000,
    });
    engine.targets = [LOCAL, SECOND];

    await add('second', 'https://127.0.0.1:9302');
    const submit = button('Adding');
    expect(isBusy(submit)).toBe(true);
    expect(engine.targetRequests('add')[0]?.body).toEqual({ name: 'second', endpoint: 'https://127.0.0.1:9302' });

    await advance(1000);
    expect(engine.targetRequests('list').length).toBe(lists + 1);
    expect(rowNames()).toEqual(['local', 'second']);
    expect(within(rowOf('second')).queryByText('Target')).toBeNull();
    expect(resultLine()).toHaveTextContent('second was added. Test it, or make it the target.');
    expect(nameInput()).toHaveValue('');
    expect(endpointInput()).toHaveValue('');
  });

  it.each([
    ['', 'https://127.0.0.1:9302', 'Name', 'Enter a name.'],
    [
      'Bad Name',
      'https://127.0.0.1:9302',
      'Name',
      'Use 1 to 64 of a–z, 0–9, - and _, starting with a letter or a digit.',
    ],
    ['second', '', 'Endpoint', 'Enter an endpoint.'],
    ['second', 'http://127.0.0.1:9302', 'Endpoint', 'Start the endpoint with https://.'],
    ['second', 'https://127.0.0.1', 'Endpoint', 'Add the port: https://127.0.0.1:<port>.'],
  ])('name %j, endpoint %j → beside %s: %s, focus there, no request', async (name, endpoint, label, text) => {
    await openPage();

    await add(name, endpoint);

    const input = screen.getByRole('textbox', { name: label });
    expect(input).toHaveAccessibleDescription(expect.stringContaining(text) as string);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(input);
    expect(engine.targetRequests('add')).toEqual([]);
  });

  it('refused TargetExists → beside Name, focus on Name, the values kept', async () => {
    await openPage();

    await add('second', 'https://127.0.0.1:9303');

    expect(nameInput()).toHaveAccessibleDescription(
      expect.stringContaining('A connection named second already exists. Choose another name.') as string,
    );
    expect(document.activeElement).toBe(nameInput());
    expect(nameInput()).toHaveValue('second');
    expect(endpointInput()).toHaveValue('https://127.0.0.1:9303');
  });

  it('refused EndpointNotLoopback → beside Endpoint, focus on Endpoint', async () => {
    await openPage();
    engine.answerTargets('add', targetsRefusal('EndpointNotLoopback', 'the host must be a loopback IP'));

    await add('third', 'https://localhost:9303');

    expect(endpointInput()).toHaveAccessibleDescription(
      expect.stringContaining(
        'Use an address on this machine: https:// and an IP in 127.0.0.0/8 or [::1], with a port. Host names, localhost included, are not accepted.',
      ) as string,
    );
    expect(document.activeElement).toBe(endpointInput());
    expect(endpointInput()).toHaveValue('https://localhost:9303');
  });

  it("refused TargetInvalid → the engine's message under the form", async () => {
    await openPage();
    engine.answerTargets('add', targetsRefusal('TargetInvalid', "the port 8301 is the engine's or Studio's own port"));

    await add('third', 'https://127.0.0.1:8301');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "The engine refused the connection: the port 8301 is the engine's or Studio's own port",
    );
    expect(within(alert).getByText("the port 8301 is the engine's or Studio's own port")).toHaveAttribute('lang', 'en');
    expect(nameInput()).toHaveValue('third');
  });
});

describe('test (R5)', () => {
  it('"Test" → "Testing"; passed → "Test passed" and five checks Passed; the list is not read again', async () => {
    await openPage();
    engine.answerTargets('test', { ...(targetTest(LOCAL) as object), delayMs: 1000 } as FakeAnswer);
    const lists = engine.targetRequests('list').length;
    const said = recordAnnouncements();

    await click(button('Test local'));
    expect(button('Test local')).toHaveTextContent('Testing');
    expect(isBusy(button('Test local'))).toBe(true);
    await advance(1000);

    const row = rowOf('local');
    expect(within(row).getByText('Test passed')).toBeInTheDocument();
    const checks = within(row)
      .getAllByRole('listitem')
      .map((item) => spaced(item));
    expect(checks).toEqual([
      'Emulator files Passed',
      'Connection Passed',
      'TLS certificate Passed',
      'Health Passed',
      'Credentials Passed',
    ]);
    expect(said.filter((line) => line === 'Test passed')).toHaveLength(1);
    expect(engine.targetRequests('list').length).toBe(lists);
  });

  it('failed → "Test failed: Emulator files", Failed with the message, the others Not run', async () => {
    await openPage();
    engine.answerTargets('test', targetTest(SECOND, 'there are no emulator files for port 9302'));

    await click(button('Test second'));

    const row = rowOf('second');
    expect(within(row).getByText('Test failed: Emulator files')).toBeInTheDocument();
    const checks = within(row)
      .getAllByRole('listitem')
      .map((item) => spaced(item));
    expect(checks).toEqual([
      'Emulator files Failed there are no emulator files for port 9302',
      'Connection Not run',
      'TLS certificate Not run',
      'Health Not run',
      'Credentials Not run',
    ]);
  });

  it('a failed check whose message the row already shows → the message once, the check still Failed', async () => {
    const message = 'there are no emulator files for port 9302';
    engine.answerTargets('info', targetInfo(LOCAL, true), targetInfo(SECOND, false, message));
    await openPage();
    engine.answerTargets('test', targetTest(SECOND, message));

    await click(button('Test second'));

    const row = rowOf('second');
    expect(within(row).getAllByText(message, { exact: false })).toHaveLength(1);
    expect(spaced(within(row).getAllByRole('listitem')[0])).toBe('Emulator files Failed');
  });

  it('no answer in 15 s → "The test did not finish in 15 seconds."; the list is not read again', async () => {
    await openPage();
    engine.answerTargets('test', { hang: true });
    const lists = engine.targetRequests('list').length;

    await click(button('Test second'));
    await advance(14_900);
    expect(rowOf('second')).not.toHaveTextContent('The test did not finish in 15 seconds.');
    await advance(100);

    expect(rowOf('second')).toHaveTextContent('The test did not finish in 15 seconds.');
    expect(engine.targetRequests('list').length).toBe(lists);
  });
});

describe('remove (R5)', () => {
  it('"Remove" on second → the dialog with its texts and focus inside; Cancel, Close and Escape close it, focus on Remove, no request', async () => {
    await openPage();
    const remove = button('Remove second');

    for (const close of [
      () => button('Cancel', screen.getByRole('dialog')),
      () => button('Close', screen.getByRole('dialog')),
    ]) {
      await click(remove);
      const dialog = screen.getByRole('dialog', { name: 'Remove second?' });
      expect(dialog).toHaveAccessibleDescription(
        'Studio forgets this connection. Its emulator and the resources in it are not touched.',
      );
      expect(button('Remove', dialog)).toBeInTheDocument();
      expect(dialog.contains(document.activeElement)).toBe(true);
      await click(close());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(button('Remove second'));
    }

    await click(remove);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await advance();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('Remove second'));
    expect(engine.targetRequests('remove')).toEqual([]);
  });

  it('the dialog makes the rest inert; a press on the veil cancels, a press on the panel does not; Escape anywhere closes it', async () => {
    await openPage();
    await click(button('Remove second'));
    const dialog = screen.getByRole('dialog', { name: 'Remove second?' });

    const banner = present(document.querySelector('header.st-bar'), 'the bar');
    const heading = screen.getByRole('heading', { level: 1, hidden: true });
    expect(banner.closest('[inert]')).not.toBeNull();
    expect(heading.closest('[inert]')).not.toBeNull();
    expect(rowOf('second').closest('[inert]')).not.toBeNull();
    expect(dialog.closest('[inert]')).toBeNull();

    fireEvent.mouseDown(dialog);
    await advance();
    expect(screen.getByRole('dialog')).toBe(dialog);

    fireEvent.mouseDown(present(dialog.parentElement, 'the veil'));
    await advance();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.activeElement).toBe(button('Remove second'));

    await click(button('Remove second'));
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: 'Escape' });
    await advance();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.activeElement).toBe(button('Remove second'));
    expect(engine.targetRequests('remove')).toEqual([]);
  });

  it('the dialog\'s "Remove" → "Removing"; 204 → "second was removed.", the list read again, focus on the list\'s heading', async () => {
    await openPage();
    engine.answerTargets('remove', { status: 204, delayMs: 1000 });
    engine.targets = [LOCAL];
    const lists = engine.targetRequests('list').length;

    await click(button('Remove second'));
    await click(button('Remove', screen.getByRole('dialog')));
    expect(isBusy(button('Removing', screen.getByRole('dialog')))).toBe(true);
    await advance(1000);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(resultLine()).toHaveTextContent('second was removed.');
    expect(engine.targetRequests('list').length).toBe(lists + 1);
    expect(rowNames()).toEqual(['local']);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Every connection' }));
  });

  it.each([
    [targetsRefusal('TargetActive'), "The target can't be removed. Make another connection the target first."],
    [targetsRefusal('TargetNotFound'), 'second was already removed.'],
  ])('refused %j → its text and the list read again', async (answer, text) => {
    await openPage();
    engine.answerTargets('remove', answer);
    const lists = engine.targetRequests('list').length;

    await click(button('Remove second'));
    await click(button('Remove', screen.getByRole('dialog')));

    expect(resultLine()).toHaveTextContent(text);
    expect(engine.targetRequests('list').length).toBe(lists + 1);
  });

  it('the target\'s row → no "Make target"; "Remove" unavailable with its reason as its description, and does nothing', async () => {
    await openPage();
    const row = rowOf('local');

    expect(within(row).queryByRole('button', { name: /the target$/ })).toBeNull();
    const remove = button('Remove local', row);
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAccessibleDescription(
      "The target can't be removed. Make another connection the target first.",
    );
    await click(remove);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the rows and the form', () => {
  it('the Compose form → no add form, its sentence, Test offered', async () => {
    engine.targets = [{ name: 'compose', endpoint: 'https://127.0.0.1:9301' }];
    engine.active = 'compose';
    engine.form = 'compose';
    await openPage();

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add connection' })).toBeNull();
    expect(
      screen.getByText(
        "This is EmuForge's Compose form. It holds one connection, its own emulator, and no other can be added.",
      ),
    ).toBeInTheDocument();
    const row = rowOf('compose');
    expect(within(row).queryByRole('button', { name: 'Make compose the target' })).toBeNull();
    expect(button('Remove compose', row)).toHaveAttribute('aria-disabled', 'true');
    await click(button('Test compose', row));
    expect(within(row).getByText('Test passed')).toBeInTheDocument();
  });

  it("the keys' folder breaks only after a /: a <wbr> after each /", async () => {
    await openPage();
    const code = present(rowOf('second').querySelector<HTMLElement>('.st-keys code'), 'the keys code');
    expect(code.textContent).toBe('~/.aws/emulator/9302/');
    const breaks = [...code.querySelectorAll('wbr')];
    expect(breaks).toHaveLength(4);
    for (const wbr of breaks) {
      expect(wbr.previousSibling?.textContent?.endsWith('/')).toBe(true);
    }
  });

  it('each row\'s controls are named "Make {name} the target", "Test {name}", "Remove {name}"', async () => {
    await openPage();

    expect(
      within(rowOf('second'))
        .getAllByRole('button')
        .map((control) => control.getAttribute('aria-label')),
    ).toEqual(['Make second the target', 'Test second', 'Remove second']);
    expect(
      within(rowOf('local'))
        .getAllByRole('button')
        .map((control) => control.getAttribute('aria-label')),
    ).toEqual(['Test local', 'Remove local']);
  });

  it("with the browser's language German → the page's texts are German's from the catalogue", async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de']);
    const de = present(BUNDLED_CATALOGUES.byTag.get('de'), 'the German catalogue');
    const german = (key: MessageKey) => String(de.messages.get(key));
    await openPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(german('connections.title'));
    expect(within(rowOf('local')).getByText(german('connections.column.keys'))).toBeInTheDocument();
    const test = within(rowOf('local')).getByRole('button', { name: 'local testen' });
    expect(test).toHaveTextContent(german('connections.test'));
    await click(test);
    expect(within(rowOf('local')).getByText(german('connections.test.passed'))).toBeInTheDocument();
    expect(german('connections.title')).not.toBe('Connections');
  });
});
