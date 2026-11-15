import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  alertRefresh,
  connected,
  connectionAlerts,
  emulatorDown,
  engineRefusal,
  FakeEngine,
  headerRefresh,
  present,
  renderApp,
  row,
  type FakeAnswer,
} from './home-test-kit';

// Requirement 2.2, in label order.
const SERVICES: [string, string][] = [
  ['Amazon API Gateway', '/apigateway'],
  ['Amazon CloudWatch', '/cloudwatch'],
  ['Amazon CloudWatch Logs', '/logs'],
  ['Amazon DynamoDB', '/dynamodb'],
  ['Amazon Elastic Compute Cloud', '/ec2'],
  ['Amazon Elastic Container Registry', '/ecr'],
  ['Amazon EventBridge', '/events'],
  ['Amazon Kinesis', '/kinesis'],
  ['Amazon Route 53', '/route53'],
  ['Amazon Simple Notification Service', '/sns'],
  ['Amazon Simple Queue Service', '/sqs'],
  ['Amazon Simple Storage Service', '/s3'],
  ['Amazon Simple Systems Manager (SSM)', '/ssm'],
  ['AWS CloudFormation', '/cloudformation'],
  ['AWS Identity and Access Management', '/iam'],
  ['AWS Key Management Service', '/kms'],
  ['AWS Lambda', '/lambda'],
  ['AWS Secrets Manager', '/secretsmanager'],
  ['AWS Step Functions', '/states'],
];

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Opens Home with the health requests answered in order, and lets the first check complete. */
async function openHome(...answers: FakeAnswer[]) {
  engine.healthAnswers = answers;
  const view = renderApp('/');
  await advance();
  return view;
}

/** A click on `element`, then everything it started that is due now. */
async function click(element: HTMLElement) {
  fireEvent.click(element);
  await advance();
}

function isLoading(button: HTMLElement): boolean {
  return button.getAttribute('aria-disabled') === 'true';
}

function bothConnected(): boolean {
  return row('Engine').status === 'Connected' && row('Emulator').status === 'Connected';
}

/** Records every text the polite announcers of Cloudscape's live regions take, in order. */
function recordAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const announcer = target?.closest('[aria-live="polite"][aria-atomic="true"]');
      if (announcer && announcer.parentElement === document.body) {
        said.push((announcer.textContent ?? '').trim());
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return said;
}

describe('Home: timed checks', () => {
  it('sends a new check 5 seconds after an answer, and a third after 10 seconds', async () => {
    await openHome(connected());
    expect(engine.healths).toHaveLength(1);
    await advance(4_999);
    expect(engine.healths).toHaveLength(1);
    await advance(1);
    expect(engine.healths).toHaveLength(2);
    await advance(5_000);
    expect(engine.healths).toHaveLength(3);
  });

  it('sends one new health request for every check, using no earlier answer', async () => {
    await openHome(connected(), emulatorDown('not_started'), connected(), engineRefusal(503, 'Busy'));
    const seen = [row('Emulator').status];
    for (let i = 0; i < 3; i++) {
      await advance(5_000);
      seen.push(row('Engine').status === 'Error' ? 'Engine error' : row('Emulator').status);
    }
    expect(engine.healths).toHaveLength(4);
    expect(seen).toEqual(['Connected', 'Not started', 'Connected', 'Engine error']);
  });
});

describe('Home: Refresh', () => {
  it('sends a check at once from the header "Refresh", which shows loading until the answer and keeps focus', async () => {
    await openHome(connected(), { ...connected(), delayMs: 1_000 });
    const refresh = headerRefresh();
    refresh.focus();
    await click(refresh);
    expect(engine.healths).toHaveLength(2);
    expect(isLoading(headerRefresh())).toBe(true);
    expect(document.activeElement).toBe(refresh);
    await advance(999);
    expect(isLoading(headerRefresh())).toBe(true);
    await advance(1);
    expect(isLoading(headerRefresh())).toBe(false);
    expect(document.activeElement).toBe(refresh);
  });

  it('sends a check at once from an engine-error alert; the alert’s and the header’s "Refresh" both show loading', async () => {
    await openHome(engineRefusal(503, 'Busy'), { ...engineRefusal(503, 'Busy'), delayMs: 1_000 });
    await click(present(alertRefresh(), 'the alert’s Refresh'));
    expect(engine.healths).toHaveLength(2);
    expect(isLoading(present(alertRefresh(), 'the alert’s Refresh'))).toBe(true);
    expect(isLoading(headerRefresh())).toBe(true);
    await advance(1_000);
    expect(isLoading(present(alertRefresh(), 'the alert’s Refresh'))).toBe(false);
    expect(isLoading(headerRefresh())).toBe(false);
  });

  it('removes the alert on a reachable answer to its "Refresh", and moves focus to the header "Refresh"', async () => {
    await openHome(engineRefusal(503, 'Busy'), { ...connected(), delayMs: 500 });
    const inAlert = present(alertRefresh(), 'the alert’s Refresh');
    inAlert.focus();
    await click(inAlert);
    await advance(500);
    expect(connectionAlerts()).toHaveLength(0);
    expect(bothConnected()).toBe(true);
    expect(document.activeElement).toBe(headerRefresh());
  });

  it('leaves focus alone when the user had left the alert before an answer removed it', async () => {
    await openHome(engineRefusal(503, 'Busy'), { ...connected(), delayMs: 500 });
    const inAlert = present(alertRefresh(), 'the alert’s Refresh');
    inAlert.focus();
    await click(inAlert);
    inAlert.blur();
    await advance(500);
    expect(connectionAlerts()).toHaveLength(0);
    expect(document.activeElement).not.toBe(headerRefresh());
  });

  it.each<[string, FakeAnswer]>([
    ['an engine-error state', engineRefusal(503, 'Busy')],
    ['an unknown-reason state', emulatorDown('a_reason_studio_does_not_know')],
  ])('in %s, Tab reaches the alert’s "Refresh" and Enter on it sends a new check', async (_name, answer) => {
    // Real timers: user-event and Testing Library wait on real ones. No check is timed within this case.
    vi.useRealTimers();
    const user = userEvent.setup();
    engine.healthAnswers = [answer];
    renderApp('/');
    const target = await screen.findByRole('button', { name: 'Refresh connection status' });
    await waitFor(() => {
      expect(isLoading(target)).toBe(false);
    });
    for (let i = 0; i < 100 && document.activeElement !== target; i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(target);
    const before = engine.healths.length;
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(engine.healths).toHaveLength(before + 1);
    });
  });

  it('keeps the earlier answer on the rows while a check is in flight, never "Checking" again', async () => {
    await openHome(connected(), { ...emulatorDown('not_started'), delayMs: 1_000 });
    await click(headerRefresh());
    for (let t = 0; t < 1_000; t += 250) {
      expect(row('Engine').status).toBe('Connected');
      expect(row('Emulator').status).toBe('Connected');
      await advance(250);
    }
    expect(row('Emulator').status).toBe('Not started');
  });

  it('shows the answer to the later of two quick Refreshes, even when the earlier answer arrives last', async () => {
    await openHome(
      connected(),
      // The first Refresh's request: answered last, by a transport that delivers even after an abort.
      { ...engineRefusal(503, 'Busy'), delayMs: 2_000, ignoreAbort: true },
      { ...emulatorDown('not_started'), delayMs: 500 },
    );
    await act(() => {
      fireEvent.click(headerRefresh());
      fireEvent.click(headerRefresh());
    });
    await advance();
    expect(engine.healths).toHaveLength(3);
    await advance(500);
    expect(row('Emulator').status).toBe('Not started');
    await advance(1_500);
    expect(row('Engine').status).toBe('Connected');
    expect(row('Emulator').status).toBe('Not started');
  });
});

describe('Home: reconnects without a reload', () => {
  it.each<[string, FakeAnswer]>([
    ['Engine unreachable', { network: true }],
    ['connection_refused', emulatorDown('connection_refused')],
  ])('a check answers %s, the next 200 reachable: "Connected" and no alert', async (_name, answer) => {
    await openHome(answer, connected());
    expect(connectionAlerts()).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1, name: 'Home' });
    await advance(5_000);
    expect(bothConnected()).toBe(true);
    expect(connectionAlerts()).toHaveLength(0);
    // The same page: nothing was mounted afresh.
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBe(heading);
  });
});

describe('Home: leaving and returning', () => {
  it('sends no check after leaving Home, and starts checking again on return', async () => {
    // The AWS area follows the operating system's scheme, which jsdom does not report: light here.
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { wrapper } = await openHome(connected());
    await click(screen.getByRole('link', { name: 'AWS' }));
    // The AWS area loads on its first opening; the import is real work, not a timer.
    const s3 = await vi.waitFor(
      async () => {
        await advance();
        return present(wrapper.findSideNavigation()?.findLinkByHref('/aws/s3'), 'the S3 link').getElement();
      },
      { timeout: 10_000, interval: 20 },
    );
    await click(s3);
    expect(screen.getByRole('heading', { level: 1, name: 'Amazon Simple Storage Service' })).toBeInTheDocument();
    const checks = engine.healths.length;
    await advance(20_000);
    expect(engine.healths).toHaveLength(checks);
    await click(screen.getByRole('link', { name: 'Go to Home' }));
    expect(engine.healths).toHaveLength(checks + 1);
    await advance(5_000);
    expect(engine.healths).toHaveLength(checks + 2);
  });
});

describe('Home: announcements', () => {
  it('announces a changed state once, an engine error with its code, and nothing when the state stays', async () => {
    await openHome(
      connected(),
      connected(),
      emulatorDown('not_started'),
      emulatorDown('not_started'),
      engineRefusal(503, 'Busy'),
    );
    const said = recordAnnouncements();
    const C = 'Engine connected. Emulator connected.';
    // Answers at 0, 5, 10, 15 and 20 seconds; a live region speaks 1 second after its text changes.
    await advance(1_000);
    expect(said).toEqual([C]);
    await advance(9_000);
    expect(said).toEqual([C]);
    await advance(1_000);
    expect(said).toEqual([C, 'Emulator not started.']);
    await advance(9_000);
    expect(said).toEqual([C, 'Emulator not started.']);
    await advance(1_000);
    expect(said).toEqual([C, 'Emulator not started.', 'Engine error: Busy.']);
  });
});

describe('Home: content', () => {
  it('shows the header with its description and "Refresh", "Connection", and "Services" with every service link', async () => {
    const { wrapper } = await openHome(connected());
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(main).toHaveTextContent('A local console for your AWS emulator, through the EmuForge engine.');
    expect(headerRefresh()).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: 'Connection' })).toBeInTheDocument();
    const services = present(
      wrapper.findAllContainers().find((c) => c.findHeader()?.getElement().textContent?.includes('Services')),
      'the Services container',
    );
    const header = present(createWrapper(services.getElement()).findHeader(), 'the Services header');
    expect(header.findCounter()?.getElement()).toHaveTextContent('(19)');
    expect(header.findDescription()?.getElement()).toHaveTextContent('No service has a Studio screen yet.');
    const links = within(services.getElement())
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual(SERVICES);
  });
});
