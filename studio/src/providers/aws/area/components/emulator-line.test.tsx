import type { ButtonProps } from '@cloudscape-design/components/button';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CheckResult } from '../../../../lib/engine/engine-client';
import { EmulatorLine, type AboutControl, type AreaConnection } from './emulator-line';

const LABEL = 'Local emulator, not AWS';
const ENGINE_ORIGIN = 'http://127.0.0.1:8297';

/** The connection Studio hands the area, as a test sets it; each change re-renders the line as Studio's frame does. */
class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: ENGINE_ORIGIN };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  answer(result: CheckResult, engineOrigin = ENGINE_ORIGIN) {
    this.value = { result, engineOrigin };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

let connection: Connection;

beforeEach(() => {
  connection = new Connection();
});

function endpoint(port: number): string {
  return `https://127.0.0.1:${String(port)}`;
}

function connected(port = 9297): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port, endpoint: endpoint(port) } };
}

function emulatorDown(reason: string, port = 9297): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port, endpoint: endpoint(port) },
    reason,
    message: 'the engine says why',
  };
}

function engineUnreachable(): CheckResult {
  return { kind: 'engine-unreachable', checkedAt: Date.now(), lastEmulatorPort: 9297 };
}

function engineError(status: number, code: string | undefined): CheckResult {
  return { kind: 'engine-error', checkedAt: Date.now(), status, code, message: undefined };
}

function Line() {
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  return <EmulatorLine connection={current} />;
}

/** The line on `/aws` inside a router, with Home at `/`. */
function open() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio's Home</p> },
      { path: '/aws/*', element: <Line /> },
    ],
    { initialEntries: ['/aws'] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

function line(): HTMLElement {
  return screen.getByRole('group', { name: LABEL });
}

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The line's status type, as Cloudscape's `StatusIndicator` marks it (`status-<type>`). */
function statusType(): string | undefined {
  const indicator = createWrapper(line()).findStatusIndicator()?.getElement();
  return [...(indicator?.classList ?? [])].map((name) => /status-([a-z-]+)_/.exec(name)?.[1]).find(Boolean);
}

function statusText(): string {
  return text(createWrapper(line()).findStatusIndicator()?.getElement() ?? null);
}

function liveRegion(): HTMLElement {
  const regions = [...document.querySelectorAll<HTMLElement>('[aria-live="polite"]')];
  expect(regions).toHaveLength(1);
  const region = regions[0] as HTMLElement;
  expect(region).toHaveAttribute('aria-atomic', 'true');
  return region;
}

function connectionStatusLink(): HTMLElement | null {
  return within(line()).queryByRole('link', { name: 'Connection status' });
}

/** Records each change of the live region's content; a region React leaves untouched records nothing. */
function recordChanges(region: HTMLElement): MutationRecord[] {
  const changes: MutationRecord[] = [];
  new MutationObserver((records) => changes.push(...records)).observe(region, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  return changes;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

const STATES: [string, () => CheckResult | undefined, string, string, boolean][] = [
  ['checking', () => undefined, 'Checking', 'loading', false],
  ['connected', () => connected(9297), `Connected at ${endpoint(9297)}`, 'success', false],
  ['not started', () => emulatorDown('not_started', 9411), 'Not started on port 9411', 'stopped', true],
  ['not answering', () => emulatorDown('timeout', 9411), `Not answering at ${endpoint(9411)}`, 'error', true],
  [
    'engine not answering',
    () => engineUnreachable(),
    `The EmuForge engine at ${ENGINE_ORIGIN} is not answering`,
    'error',
    true,
  ],
  [
    'engine error with a code',
    () => engineError(403, 'OriginNotAllowed'),
    'The EmuForge engine answered with an error: OriginNotAllowed',
    'error',
    true,
  ],
  [
    'engine error without a code',
    () => engineError(502, undefined),
    'The EmuForge engine answered with HTTP status 502',
    'error',
    true,
  ],
];

describe('the emulator line', () => {
  it.each(STATES)('%s: the label, then "%s", marked %s', (_name, result, status, type, recovery) => {
    const answer = result();
    if (answer !== undefined) {
      connection.value = { result: answer, engineOrigin: ENGINE_ORIGIN };
    }
    open();

    // The label, then the status, then the link when there is one: each its own part of the line.
    const label = within(line()).getByText(LABEL);
    const indicator = createWrapper(line()).findStatusIndicator()?.getElement() as HTMLElement;
    expect(follows(label, indicator)).toBe(true);
    expect(text(line())).toBe(`${LABEL}${status}${recovery ? 'Connection status' : ''}`);
    expect(statusText()).toBe(status);
    expect(statusType()).toBe(type);
    if (recovery) {
      expect(connectionStatusLink()).toHaveAttribute('href', '/');
      expect(follows(indicator, connectionStatusLink() as HTMLElement)).toBe(true);
    } else {
      expect(connectionStatusLink()).toBeNull();
    }
  });

  it.each(STATES)(
    '%s: the label is the same text, and the line has no control that closes or hides it',
    (_n, result) => {
      const answer = result();
      if (answer !== undefined) {
        connection.value = { result: answer, engineOrigin: ENGINE_ORIGIN };
      }
      open();

      expect(line()).toHaveAccessibleName(LABEL);
      expect(within(line()).getByText(LABEL)).toBeInTheDocument();
      expect(within(line()).queryAllByRole('button')).toEqual([]);
      expect(
        within(line())
          .queryAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(result()?.kind === undefined || result()?.kind === 'connected' ? [] : ['Connection status']);
    },
  );

  it.each([
    ['the engine does not answer', engineUnreachable()],
    ['the engine answers with an error that has a code', engineError(403, 'OriginNotAllowed')],
    ['the engine answers with an error without a code', engineError(502, undefined)],
  ])('%s: the line shows no emulator endpoint and no emulator port', (_n, result) => {
    connection.value = { result, engineOrigin: ENGINE_ORIGIN };
    open();

    expect(text(line())).not.toContain('https://');
    expect(text(line())).not.toContain('9297');
  });

  it('two endpoints in two renders: each render shows the endpoint it was given', () => {
    connection.value = { result: connected(9297), engineOrigin: ENGINE_ORIGIN };
    open();
    expect(statusText()).toBe('Connected at https://127.0.0.1:9297');

    connection.answer(connected(9411));

    expect(statusText()).toBe('Connected at https://127.0.0.1:9411');
  });

  it('an error code that holds markup: shown as that text, and the line holds no img element', () => {
    const code = '<img src=x onerror=alert(1)>';
    connection.value = { result: engineError(400, code), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(statusText()).toBe(`The EmuForge engine answered with an error: ${code}`);
    expect(line().querySelector('img')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('a very long error code without spaces: the whole code is in the line as text', () => {
    const code = 'E'.repeat(200);
    connection.value = { result: engineError(400, code), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(statusText()).toBe(`The EmuForge engine answered with an error: ${code}`);
  });

  it('connected, then not started: the live region holds the label and the new status together, without the link', async () => {
    connection.value = { result: connected(9411), engineOrigin: ENGINE_ORIGIN };
    open();
    expect(text(liveRegion())).toBe('');

    connection.answer(emulatorDown('not_started', 9411));
    await settle();

    expect(text(liveRegion())).toBe(`${LABEL} Not started on port 9411`);
    expect(within(liveRegion()).queryByRole('link')).toBeNull();
    expect(liveRegion()).not.toHaveTextContent('Connection status');
    expect(line().contains(liveRegion())).toBe(false);
  });

  it('back to connected: the live region holds the label and "Connected at <endpoint>"', async () => {
    connection.value = { result: connected(9411), engineOrigin: ENGINE_ORIGIN };
    open();
    connection.answer(emulatorDown('not_started', 9411));
    await settle();

    connection.answer(connected(9411));
    await settle();

    expect(text(liveRegion())).toBe(`${LABEL} Connected at ${endpoint(9411)}`);
  });

  it('a later check that answers the same state: the live region’s content is not replaced', async () => {
    connection.value = { result: connected(9411), engineOrigin: ENGINE_ORIGIN };
    open();
    connection.answer(emulatorDown('not_started', 9411));
    await settle();
    const changes = recordChanges(liveRegion());

    connection.answer(emulatorDown('not_started', 9411));
    connection.answer(emulatorDown('not_started', 9411));
    await settle();

    expect(changes).toEqual([]);
    expect(text(liveRegion())).toBe(`${LABEL} Not started on port 9411`);
  });

  it('a first answer that is connected: nothing is put into the live region after "Checking"', async () => {
    open();
    expect(statusText()).toBe('Checking');
    const changes = recordChanges(liveRegion());

    connection.answer(connected(9411));
    await settle();

    expect(statusText()).toBe(`Connected at ${endpoint(9411)}`);
    expect(changes).toEqual([]);
    expect(text(liveRegion())).toBe('');
  });

  it('a first answer that is not started: the live region holds the label and "Not started on port <port>"', async () => {
    open();

    connection.answer(emulatorDown('not_started', 9411));
    await settle();

    expect(text(liveRegion())).toBe(`${LABEL} Not started on port 9411`);
  });

  it('a later check in flight after a connected answer: the line still reads "Connected at <endpoint>"', () => {
    open();
    connection.answer(connected(9411));

    // Studio's frame keeps the latest answer while the next check is in flight: the line is handed it again.
    connection.answer(connection.value.result as CheckResult);

    expect(statusText()).toBe(`Connected at ${endpoint(9411)}`);
    expect(statusType()).toBe('success');
  });

  it('"Connection status" chosen: the path is /, without a reload of the document', () => {
    connection.value = { result: emulatorDown('not_started', 9411), engineOrigin: ENGINE_ORIGIN };
    const { router } = open();
    const link = connectionStatusLink() as HTMLElement;

    let followed = true;
    act(() => {
      followed = fireEvent.click(link);
    });

    // A click whose default is prevented: the router moved, the browser did not load the address.
    expect(followed).toBe(false);
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText("Studio's Home")).toBeInTheDocument();
  });
});

/** `result` as an answer that names the target `target`. */
function naming(result: CheckResult, target: string): CheckResult {
  return { ...result, target } as CheckResult;
}

/** The line's part that names the target: "Target" and the name; `null` when the line names none. */
function targetPart(): HTMLElement | null {
  return line().querySelector('.aws-area-emulator-target');
}

describe("the emulator line's target (issue 486, R2)", () => {
  it('connected with target local: "Connected at <endpoint>" unchanged, then a part "Target local", the name in code style', () => {
    connection.value = { result: naming(connected(9297), 'local'), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(statusText()).toBe(`Connected at ${endpoint(9297)}`);
    expect(statusType()).toBe('success');
    const part = targetPart() as HTMLElement;
    expect(text(part)).toBe('Target local');
    expect(createWrapper(part).findBox()?.getElement()).toHaveTextContent('local');
    expect(part.querySelector('code, [class*="awsui_box"]')).not.toBeNull();
    expect(createWrapper(line()).findStatusIndicator()?.getElement().contains(part)).toBe(false);
    expect(follows(createWrapper(line()).findStatusIndicator()?.getElement() as HTMLElement, part)).toBe(true);
  });

  it.each([
    ['not started', 'not_started', 'Not started on port 9297', 'stopped'],
    ['not answering', 'timeout', `Not answering at ${endpoint(9297)}`, 'error'],
  ])('%s with target local: the status unchanged, then "Target local", then "Connection status"', (_name, reason, status, type) => {
    connection.value = { result: naming(emulatorDown(reason, 9297), 'local'), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(statusText()).toBe(status);
    expect(statusType()).toBe(type);
    const part = targetPart() as HTMLElement;
    expect(text(part)).toBe('Target local');
    const link = connectionStatusLink() as HTMLElement;
    expect(follows(part, link)).toBe(true);
  });

  it.each([
    ['engine not answering', engineUnreachable, `The EmuForge engine at ${ENGINE_ORIGIN} is not answering`],
    ['engine error', () => engineError(403, 'OriginNotAllowed'), 'The EmuForge engine answered with an error: OriginNotAllowed'],
  ])('%s: as before, no target part', (_name, result, status) => {
    connection.value = { result: result(), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(statusText()).toBe(status);
    expect(targetPart()).toBeNull();
    expect(line()).not.toHaveTextContent('Target');
  });

  it.each([
    ['connected', () => connected(9297), `Connected at ${endpoint(9297)}`],
    ['not started', () => emulatorDown('not_started', 9297), 'Not started on port 9297'],
  ])('%s with no target: as before, no target part', (_name, result, status) => {
    connection.value = { result: result(), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(statusText()).toBe(status);
    expect(targetPart()).toBeNull();
    expect(line()).not.toHaveTextContent('Target');
  });

  it('connected local, then connected second at another endpoint: the line names second, its live region says nothing', async () => {
    connection.value = { result: naming(connected(9301), 'local'), engineOrigin: ENGINE_ORIGIN };
    open();
    const changes = recordChanges(liveRegion());

    connection.answer(naming(connected(9302), 'second'));
    await settle();

    expect(statusText()).toBe(`Connected at ${endpoint(9302)}`);
    expect(text(targetPart())).toBe('Target second');
    expect(changes).toEqual([]);
    expect(text(liveRegion())).toBe('');
  });

  it('connected local, then not started with local: the live region holds the label and the whole line, as before', async () => {
    connection.value = { result: naming(connected(9301), 'local'), engineOrigin: ENGINE_ORIGIN };
    open();

    connection.answer(naming(emulatorDown('not_started', 9301), 'local'));
    await settle();

    expect(text(liveRegion())).toBe(`${LABEL} Not started on port 9301 Target local`);
    expect(liveRegion()).not.toHaveTextContent('Connection status');
  });

  it('connected local, then not started with second: a change of status, announced as before', async () => {
    connection.value = { result: naming(connected(9301), 'local'), engineOrigin: ENGINE_ORIGIN };
    open();

    connection.answer(naming(emulatorDown('not_started', 9302), 'second'));
    await settle();

    expect(text(liveRegion())).toBe(`${LABEL} Not started on port 9302 Target second`);
  });

  it('a target that holds markup: shown as that text, no element made from it', () => {
    connection.value = { result: naming(connected(9297), '<img src=x>'), engineOrigin: ENGINE_ORIGIN };
    open();

    expect(text(targetPart())).toBe('Target <img src=x>');
    expect(line().querySelector('img')).toBeNull();
  });
});

describe("the emulator line's (i) control (issue 45, R5.4)", () => {
  const ABOUT = 'About the local emulator';

  /** The line on `/aws` inside a router, with the (i) control of a page that carries the notice, or without. */
  function openWith(about: AboutControl | undefined) {
    const aboutRef = createRef<ButtonProps.Ref>();
    function LineWithAbout() {
      const current = useSyncExternalStore(connection.subscribe, connection.get);
      return <EmulatorLine connection={current} about={about} aboutRef={aboutRef} />;
    }
    const router = createMemoryRouter([{ path: '/aws/*', element: <LineWithAbout /> }], {
      initialEntries: ['/aws'],
    });
    render(<RouterProvider router={router} />);
  }

  function aboutControl(): AboutControl {
    return { open: true, noticeId: 'the-notice', onToggle: () => undefined };
  }

  it.each([
    ['connected', () => connected(9297)],
    ['not started', () => emulatorDown('not_started', 9411)],
  ])('%s, on a page without resources: no "About the local emulator" control', (_name, result) => {
    connection.value = { result: result(), engineOrigin: ENGINE_ORIGIN };
    openWith(undefined);

    expect(within(line()).queryByRole('button', { name: ABOUT })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('connected, on a page with resources: the line ends with the control, and there is no link', () => {
    connection.value = { result: connected(9297), engineOrigin: ENGINE_ORIGIN };
    openWith(aboutControl());

    const about = within(line()).getByRole('button', { name: ABOUT });
    const indicator = createWrapper(line()).findStatusIndicator()?.getElement() as HTMLElement;
    expect(follows(indicator, about)).toBe(true);
    expect(connectionStatusLink()).toBeNull();
    expect(about).toHaveAttribute('aria-expanded', 'true');
  });

  it('not started, on a page with resources: the control comes after "Connection status", the last of the line', () => {
    connection.value = { result: emulatorDown('not_started', 9411), engineOrigin: ENGINE_ORIGIN };
    openWith(aboutControl());

    const about = within(line()).getByRole('button', { name: ABOUT });
    expect(follows(connectionStatusLink() as HTMLElement, about)).toBe(true);
    const controls = [...line().querySelectorAll('a[href], button')];
    expect(controls.at(-1)).toBe(about);
  });
});
