import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_COMMAND_LINE,
  startEmulatorCommand,
  startEngineCommand,
  stopEmulatorCommand,
  BUILD_IMAGE_COMMAND,
} from './commands';
import {
  advance,
  commandsIn,
  connected,
  connectionAlert,
  connectionAlerts,
  connectionDescription,
  emulatorDown,
  engineRefusal,
  FakeEngine,
  inAlert,
  present,
  renderApp,
  row,
  type FakeAnswer,
} from './home-test-kit';

const RECHECK = 'Studio checks again every 5 seconds; this page updates on its own.';
const ENGINE = 'http://127.0.0.1:8297';
const EMULATOR = 'https://127.0.0.1:9297';
// The page's own port in the test browser: Studio's port, which the engine command names.
const STUDIO_PORT = window.location.port;
const STOP_9297 = ['docker rm -f \\', '  emuforge-emulator-9297'];
const BUILD = ['cd infra/aws-emulator', 'docker compose build'];

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  // Local time 16:05:12, whatever the machine's time zone.
  vi.setSystemTime(new Date(2026, 10, 15, 16, 5, 12));
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function click(element: HTMLElement) {
  fireEvent.click(element);
  await advance();
}

/** Opens Home with the first health request answered `answer`, and lets that check complete. */
async function openHomeAnswered(answer: FakeAnswer) {
  engine.healthAnswers = [answer];
  const view = renderApp('/');
  await advance();
  return view;
}

function alertType(): string | undefined {
  const root = connectionAlert().findRootElement().getElement();
  const own = [root, ...root.querySelectorAll('*')].map((el) => String(el.className)).join(' ');
  return /type-(error|info|warning|success)/.exec(own)?.[1];
}

function alertText(): string {
  return (connectionAlert().getElement().textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Labels and buttons of the alert, in document order, for step and order checks. */
function alertButtons(): HTMLElement[] {
  return [...connectionAlert().getElement().querySelectorAll<HTMLElement>('button, [role="button"]')];
}

function isCopyOrToggle(button: HTMLElement): boolean {
  return (button.getAttribute('aria-label') ?? '').startsWith('Copy command:') || button.hasAttribute('aria-expanded');
}

/** Whether `element` sits in a collapsed expandable section of the alert. */
function collapsedIn(element: HTMLElement): boolean {
  return inAlert()
    .findAllExpandableSections()
    .some((section) => section.findExpandedContent() === null && section.getElement().contains(element));
}

/** The build-once section of the alert. */
function buildOnce() {
  const section = inAlert().findExpandableSection();
  expect(section).not.toBeNull();
  return present(section, 'the build-once section');
}

/** Positions in the alert's text, to check what comes before what. */
function positionsIn(text: string, parts: string[]): number[] {
  return parts.map((part) => {
    const at = text.indexOf(part);
    expect(at, `"${part}" in the alert`).toBeGreaterThanOrEqual(0);
    return at;
  });
}

function expectAscending(values: number[]) {
  expect([...values].sort((a, b) => a - b)).toEqual(values);
}

describe('Connection: Checking and Connected', () => {
  it('shows both rows "Checking", "Not checked yet." and no alert while the first check has no answer', async () => {
    engine.healthAnswers = [{ hang: true }];
    renderApp('/');
    await advance();
    expect(row('Engine').status).toBe('Checking');
    expect(row('Emulator').status).toBe('Checking');
    expect(connectionDescription()).toBe('Not checked yet.');
    expect(connectionAlerts()).toHaveLength(0);
  });

  it('shows both rows "Connected" with their endpoints, no alert and the time of the answer', async () => {
    await openHomeAnswered(connected(9297));
    expect(row('Engine')).toMatchObject({ status: 'Connected', text: expect.stringContaining(ENGINE) as string });
    expect(row('Emulator')).toMatchObject({ status: 'Connected', text: expect.stringContaining(EMULATOR) as string });
    expect(connectionAlerts()).toHaveLength(0);
    expect(connectionDescription()).toBe('Last checked 16:05:12. Checked every 5 seconds.');
  });
});

describe('Connection: emulator not started', () => {
  it('shows "Not started", an info alert naming the port with the build-once section, then the start command', async () => {
    await openHomeAnswered(emulatorDown('not_started', 9297));
    expect(row('Emulator')).toMatchObject({ status: 'Not started', text: expect.stringContaining(EMULATOR) as string });
    expect(alertType()).toBe('info');
    expect(connectionAlert().findHeader()?.getElement()).toHaveTextContent('No emulator is running on port 9297');
    const text = alertText();
    expectAscending(positionsIn(text, ['First run? Build the image once', 'Start the emulator on port 9297']));
    expect(buildOnce().findExpandedContent()).toBeNull();
    expect(commandsIn(connectionAlert())).toEqual([startEmulatorCommand(9297).split('\n')]);
    expect(text).not.toContain('Stop');
    expect(text).not.toContain('docker rm');
  });

  it('shows the build commands with a copy button when the build-once section is expanded, and hides them again', async () => {
    await openHomeAnswered(emulatorDown('not_started', 9297));
    await click(buildOnce().findExpandButton().getElement());
    const content = buildOnce().findExpandedContent();
    expect(content).not.toBeNull();
    expect(commandsIn(present(content, 'the expanded content'))).toEqual([BUILD]);
    expect(createWrapper(present(content, 'the expanded content').getElement()).findCopyToClipboard()).not.toBeNull();
    await click(buildOnce().findExpandButton().getElement());
    expect(buildOnce().findExpandedContent()).toBeNull();
    expect(commandsIn(connectionAlert())).toEqual([startEmulatorCommand(9297).split('\n')]);
  });
});

describe('Connection: emulator unreachable with a recovery step', () => {
  const cases: [string, string, string][] = [
    ['connection_refused', 'The emulator stopped without cleaning up (killed).', 'Stop what is left of the emulator'],
    ['tls_untrusted', 'The files on disk belong to another emulator run.', 'Stop the emulator on port 9297'],
    [
      'files_unreadable',
      "The engine cannot read the emulator's files for port 9297.",
      'Stop the emulator on port 9297',
    ],
    ['timeout', 'The emulator accepts connections but does not answer.', 'Stop the emulator'],
  ];

  it.each(cases)(
    'reason %s: "Unreachable", the engine message, what happened, build-once, step 1 stop, step 2 start',
    async (reason, explanation, stopLabel) => {
      const message = `nothing answers on ${EMULATOR} (${reason})`;
      await openHomeAnswered(emulatorDown(reason, 9297, message));
      expect(row('Emulator')).toMatchObject({
        status: 'Unreachable',
        text: expect.stringContaining(EMULATOR) as string,
      });
      expect(row('Engine').status).toBe('Connected');
      expect(alertType()).toBe('error');
      const text = alertText();
      expect(text).toContain(`Engine message: ${message}`);
      expect(text).toContain(explanation);
      expectAscending(
        positionsIn(text, [
          'Engine message:',
          explanation,
          'First run? Build the image once',
          `1. ${stopLabel} (`,
          '2. Start the emulator on port 9297',
        ]),
      );
      expect(commandsIn(connectionAlert())).toEqual([STOP_9297, startEmulatorCommand(9297).split('\n')]);
      expect(alertButtons().every(isCopyOrToggle)).toBe(true);
    },
  );
});

describe('Connection: emulator unreachable without a recovery step', () => {
  it.each(['unexpected_response', 'connection_failed', 'a_reason_studio_does_not_know'])(
    'reason %s: "Unreachable", the engine message only, no command, "Refresh" in the action slot',
    async (reason) => {
      const message = `the emulator at ${EMULATOR} answered with status 502, not 200 ok`;
      await openHomeAnswered(emulatorDown(reason, 9297, message));
      expect(row('Emulator').status).toBe('Unreachable');
      expect(row('Engine').status).toBe('Connected');
      expect(alertText()).toContain(`Engine message: ${message}`);
      expect(commandsIn(connectionAlert())).toEqual([]);
      expect(inAlert().findExpandableSection()).toBeNull();
      const action = connectionAlert().findActionSlot();
      expect(action?.findButton()?.getElement()).toHaveAccessibleName('Refresh connection status');
    },
  );
});

const EMULATOR_STATES: [string, FakeAnswer][] = [
  ['not_started', emulatorDown('not_started')],
  ['connection_refused', emulatorDown('connection_refused')],
  ['tls_untrusted', emulatorDown('tls_untrusted')],
  ['files_unreadable', emulatorDown('files_unreadable')],
  ['timeout', emulatorDown('timeout')],
  ['unexpected_response', emulatorDown('unexpected_response')],
  ['connection_failed', emulatorDown('connection_failed')],
  ['an unknown reason', emulatorDown('something_new')],
];

const ALERT_STATES: [string, FakeAnswer][] = [
  ...EMULATOR_STATES,
  ['engine unreachable', { network: true }],
  ['engine error Busy', engineRefusal(503, 'Busy')],
  ['engine error HTTP status only', { status: 500 }],
];

describe('Connection: every state', () => {
  it.each(EMULATOR_STATES)('emulator state %s: the Engine row shows "Connected"', async (_name, answer) => {
    await openHomeAnswered(answer);
    expect(row('Engine')).toMatchObject({ status: 'Connected', text: expect.stringContaining(ENGINE) as string });
  });

  it.each(ALERT_STATES)(
    '%s: the alert ends with the re-check line and the description has no interval',
    async (_name, answer) => {
      await openHomeAnswered(answer);
      const content = (connectionAlert().findContent().getElement().textContent ?? '').replace(/\s+/g, ' ').trim();
      expect(content.endsWith(RECHECK), content).toBe(true);
      expect(connectionDescription()).toBe('Last checked 16:05:12.');
    },
  );

  it.each(ALERT_STATES)(
    '%s: every command line is at most 26 characters and its copy button copies exactly the text shown',
    async (_name, answer) => {
      await openHomeAnswered(answer);
      const section = inAlert().findExpandableSection();
      if (section !== null) {
        await click(section.findExpandButton().getElement());
      }
      const shown = commandsIn(connectionAlert());
      for (const line of shown.flat()) {
        expect(line.length, line).toBeLessThanOrEqual(MAX_COMMAND_LINE);
      }
      const copyButtons = inAlert()
        .findAllCopyToClipboards()
        .filter((copy) => !collapsedIn(copy.getElement()))
        .map((copy) => copy.findCopyButton().getElement());
      expect(copyButtons).toHaveLength(shown.length);
      const copied: string[] = [];
      const writeText = vi.fn((text: string) => {
        copied.push(text);
        return Promise.resolve();
      });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      for (const button of copyButtons) {
        await click(present(button, 'a copy button'));
      }
      expect(copied).toEqual(shown.map((lines) => lines.join('\n')));
    },
  );

  it('keeps every line of the start, stop and engine commands at most 26 characters with 5-digit ports', () => {
    const commands = [
      startEmulatorCommand(65533),
      stopEmulatorCommand(65533),
      startEngineCommand({ enginePort: 65535, studioPort: 65534 }),
      startEngineCommand({ enginePort: 65535, studioPort: 65534, emulatorPort: 65533 }),
      BUILD_IMAGE_COMMAND,
    ];
    for (const line of commands.flatMap((c) => c.split('\n'))) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_COMMAND_LINE);
    }
  });

  it('shows the start command for port 9393 line by line', async () => {
    await openHomeAnswered(emulatorDown('not_started', 9393));
    expect(commandsIn(connectionAlert())).toEqual([
      [
        'E=$HOME/.aws/emulator',
        'P=9393',
        'docker run -d \\',
        '  --name \\',
        '  emuforge-emulator-$P \\',
        '  -p 127.0.0.1:$P:$P \\',
        '  -e HOME=$HOME \\',
        '  -v $E:$E \\',
        '  aws-emulator \\',
        '  -p $P -t off',
      ],
    ]);
  });

  it('says in its own words, not as the engine message, that the engine sent no message', async () => {
    await openHomeAnswered(emulatorDown('unexpected_response', 9297, ''));
    expect(alertText()).toContain(`The engine gave no message for ${EMULATOR}.`);
    expect(alertText()).not.toContain('Engine message:');
  });

  it('shows an engine message that looks like HTML as those characters, creating no element from it', async () => {
    await openHomeAnswered(emulatorDown('unexpected_response', 9297, '<b>x</b><script>'));
    expect(alertText()).toContain('Engine message: <b>x</b><script>');
    const alert = connectionAlert().getElement();
    expect(alert.querySelector('b')).toBeNull();
    expect(alert.querySelector('script')).toBeNull();
  });
});

describe('Connection: engine unreachable', () => {
  function expectEngineUnreachable(emulatorPort?: number) {
    expect(row('Engine')).toMatchObject({ status: 'Unreachable', text: expect.stringContaining(ENGINE) as string });
    expect(row('Emulator').status).toBe('Unknown');
    // A dash on screen; "Not known" for a screen reader.
    expect(row('Emulator').text).toBe('EmulatorUnknown-Not known');
    expect(alertType()).toBe('error');
    expect(connectionAlert().findHeader()?.getElement()).toHaveTextContent('Studio cannot reach the engine');
    const text = alertText();
    expect(text).toContain(`Studio gets no answer it can read from the engine at ${ENGINE}.`);
    expect(text).toContain(
      'Either the engine is not running on that port, or it was started for another Studio origin.',
    );
    const command = [
      'cargo run \\',
      '  -p emuforge-server -- \\',
      '  --port 8297 \\',
      ...(emulatorPort === undefined
        ? [`  --studio-port ${STUDIO_PORT}`]
        : [`  --studio-port ${STUDIO_PORT} \\`, `  --emulator-port ${String(emulatorPort)}`]),
    ];
    expect(commandsIn(connectionAlert())).toEqual([command]);
    return text;
  }

  it.each([
    ['the session request is refused at the network level', 'session'],
    ['the health request gets an answer the browser withholds', 'health'],
  ])('%s, with no earlier answer: the engine command without --emulator-port', async (_name, which) => {
    if (which === 'session') {
      engine.sessionAnswers = [{ network: true }];
    }
    await openHomeAnswered({ network: true });
    const text = expectEngineUnreachable();
    expect(text).not.toContain('--emulator-port 9297');
    expect(text).toContain('Add --emulator-port <port> if your emulator is not on 9297.');
    expect(connectionDescription()).toBe('Last checked 16:05:12.');
  });

  it('after an earlier answer reported port 9393: the command ends with --emulator-port 9393, and says why', async () => {
    engine.healthAnswers = [connected(9393), { network: true }];
    renderApp('/');
    await advance();
    expect(row('Emulator').status).toBe('Connected');
    vi.setSystemTime(new Date(2026, 10, 15, 16, 7, 40));
    await advance(5_000);
    const text = expectEngineUnreachable(9393);
    expect(text).toContain('--emulator-port 9393 is the emulator port the engine last reported.');
    expect(connectionDescription()).toBe('Last checked 16:07:45.');
  });

  it('a single request with no answer 5 seconds after the check started: "Unreachable", and it is aborted', async () => {
    engine.healthAnswers = [{ hang: true }];
    renderApp('/');
    await advance(4_999);
    expect(row('Engine').status).toBe('Checking');
    await advance(1);
    expectEngineUnreachable();
    expect(engine.healths).toHaveLength(1);
    expect(present(engine.healths[0], 'the health request').aborted()).toBe(true);
  });

  it('a session request, a 401 and a retry that together take more than 5 seconds: "Unreachable", aborted', async () => {
    engine.sessionAnswers = [
      { status: 200, json: { token: 'a'.repeat(64) }, delayMs: 1_500 },
      { status: 200, json: { token: 'b'.repeat(64) }, delayMs: 1_500 },
    ];
    engine.healthAnswers = [
      { ...engineRefusal(401, 'SessionInvalid'), delayMs: 1_500 },
      { ...connected(), delayMs: 1_000 },
    ];
    renderApp('/');
    await advance(4_999);
    expect(row('Engine').status).toBe('Checking');
    await advance(1);
    expectEngineUnreachable();
    expect(engine.healths).toHaveLength(2);
    expect(present(engine.healths[1], 'the retried health request').aborted()).toBe(true);
  });

  it('a check that completes 4.9 seconds after it started shows its answer', async () => {
    engine.sessionAnswers = [{ status: 200, json: { token: 'a'.repeat(64) }, delayMs: 2_000 }];
    engine.healthAnswers = [{ ...connected(), delayMs: 2_900 }];
    renderApp('/');
    await advance(4_900);
    expect(row('Engine').status).toBe('Connected');
    expect(row('Emulator').status).toBe('Connected');
  });
});

describe('Connection: engine error', () => {
  function expectEngineError() {
    expect(row('Engine')).toMatchObject({ status: 'Error', text: expect.stringContaining(ENGINE) as string });
    expect(row('Emulator').status).toBe('Unknown');
    // A dash on screen; "Not known" for a screen reader.
    expect(row('Emulator').text).toBe('EmulatorUnknown-Not known');
    expect(alertType()).toBe('error');
    expect(connectionAlert().findHeader()?.getElement()).toHaveTextContent('The engine answered with an error');
    expect(connectionAlert().findActionSlot()?.findButton()?.getElement()).toHaveAccessibleName(
      'Refresh connection status',
    );
  }

  it('503 Busy: "Error", "Unknown", the code and message after "Engine error:", and "Refresh"', async () => {
    await openHomeAnswered(engineRefusal(503, 'Busy', 'The engine has too many requests in flight.'));
    expectEngineError();
    expect(alertText()).toContain('Engine error: Busy: The engine has too many requests in flight.');
  });

  it('403 OriginNotAllowed: the code and the message', async () => {
    await openHomeAnswered(engineRefusal(403, 'OriginNotAllowed', 'this origin is not the Studio origin'));
    expectEngineError();
    expect(alertText()).toContain('Engine error: OriginNotAllowed: this origin is not the Studio origin');
  });

  it.each<[string, FakeAnswer, string]>([
    ['404 with an error body', engineRefusal(404, 'NotFound', 'no route'), 'Engine error: NotFound: no route'],
    ['200 with a body that is not JSON', { status: 200, text: '<html>' }, 'HTTP status 200'],
    [
      '200 with JSON missing emulator.reachable',
      { status: 200, json: { emulator: { port: 9297, endpoint: EMULATOR } } },
      'HTTP status 200',
    ],
    ['500 with no body', { status: 500 }, 'HTTP status 500'],
  ])(
    '%s: "Error", with the code and message when the body has them, else the HTTP status',
    async (_n, answer, shown) => {
      await openHomeAnswered(answer);
      expectEngineError();
      expect(alertText()).toContain(shown);
    },
  );
});

describe('Connection: the alert\'s "Refresh"', () => {
  it.each<[string, FakeAnswer]>([
    ['engine error', engineRefusal(503, 'Busy')],
    ['a reason without a recovery step', emulatorDown('unexpected_response')],
  ])('%s: the alert carries "Refresh" named "Refresh connection status"', async (_name, answer) => {
    await openHomeAnswered(answer);
    const refresh = screen.getByRole('button', { name: 'Refresh connection status' });
    expect(connectionAlert().getElement()).toContainElement(refresh);
    expect(refresh).toHaveTextContent('Refresh');
  });

  it.each<[string, FakeAnswer]>([
    ['not started', emulatorDown('not_started')],
    ['a reason with a recovery step', emulatorDown('connection_refused')],
    ['engine unreachable', { network: true }],
  ])('%s: the alert has no button besides copy buttons and the build-once toggle', async (_name, answer) => {
    await openHomeAnswered(answer);
    expect(alertButtons().length).toBeGreaterThan(0);
    expect(alertButtons().filter((b) => !isCopyOrToggle(b))).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Refresh connection status' })).toBeNull();
  });
});
