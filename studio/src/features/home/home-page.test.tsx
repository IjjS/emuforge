import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  cloudscapeElements,
  connected,
  connectionNotices,
  connectionSection,
  emulatorDown,
  engineRefusal,
  FakeEngine,
  headerRefresh,
  noticeRefresh,
  present,
  renderApp,
  row,
  type FakeAnswer,
} from '../../test/home-test-kit';
import { serviceLinks } from '../../test/service-files';
import { PROVIDERS, type Provider, type ProviderService } from '../../app/provider-list';
import { Providers } from '../../app/providers';
import { BUNDLED_CATALOGUES } from '../../i18n/bundled';
import { languageStore } from '../../test/home-test-kit';
import { ProvidersSection } from './providers-section';

// The services as their folders give them (providers/aws/area/services/*/service.json), in the order of issue 386's
// requirement R13.2, each under /aws.
const SERVICES = serviceLinks();

let engine: FakeEngine;

/** The line under a provider's name in `region`: the paragraph that counts its services. */
function providerLine(region: HTMLElement): HTMLElement {
  return within(region).getByText(
    (_content, element) => element?.tagName === 'P' && /\d/.test(element.textContent ?? ''),
  );
}

/** `total` services of a test provider, the first `withScreen` of them with a Studio screen. */
function testServices(total: number, withScreen: number): ProviderService[] {
  return Array.from({ length: total }, (_, index) => ({
    label: `Service ${String(index + 1).padStart(4, '0')}`,
    path: `/test/s${String(index + 1)}`,
    hasScreen: index < withScreen,
  }));
}

/** Home's providers section alone for one test provider of `services`, in `tag`. */
function renderProvider(services: readonly ProviderService[], tag = 'en') {
  const provider: Provider = {
    name: 'Test Cloud',
    shortName: 'Test',
    segment: 'test',
    services,
    loadArea: () => new Promise(() => undefined),
  };
  const router = createMemoryRouter([{ path: '*', element: <ProvidersSection providers={[provider]} /> }]);
  render(
    <Providers language={languageStore(tag, BUNDLED_CATALOGUES)}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return screen.getByRole('region', { name: /\(1\)$/ });
}

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

/**
 * Records every text a polite region of the "Connection" section takes, in order, from before Home is rendered: each
 * change of a region's content is one announcement. A region React leaves untouched says nothing.
 */
function recordAnnouncements(): string[] {
  const said: string[] = [];
  const observer = new MutationObserver((records) => {
    const changed = new Set<Element>();
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const region = target?.closest('[aria-live="polite"]');
      if (region && region.closest('section')?.getAttribute('aria-labelledby') !== null) {
        changed.add(region);
      }
    }
    for (const region of changed) {
      const text = (region.textContent ?? '').trim();
      if (text !== '') {
        said.push(text);
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

  it('sends a check at once from an engine-error notice; the notice’s and the header’s "Refresh" both show loading', async () => {
    await openHome(engineRefusal(503, 'Busy'), { ...engineRefusal(503, 'Busy'), delayMs: 1_000 });
    await click(present(noticeRefresh(), 'the notice’s Refresh'));
    expect(engine.healths).toHaveLength(2);
    expect(isLoading(present(noticeRefresh(), 'the notice’s Refresh'))).toBe(true);
    expect(isLoading(headerRefresh())).toBe(true);
    await advance(1_000);
    expect(isLoading(present(noticeRefresh(), 'the notice’s Refresh'))).toBe(false);
    expect(isLoading(headerRefresh())).toBe(false);
  });

  it('removes the notice on a reachable answer to its "Refresh", and moves focus to the header "Refresh"', async () => {
    await openHome(engineRefusal(503, 'Busy'), { ...connected(), delayMs: 500 });
    const inNotice = present(noticeRefresh(), 'the notice’s Refresh');
    inNotice.focus();
    await click(inNotice);
    await advance(500);
    expect(connectionNotices()).toHaveLength(0);
    expect(bothConnected()).toBe(true);
    expect(document.activeElement).toBe(headerRefresh());
  });

  it('leaves focus alone when the user had left the notice before an answer removed it', async () => {
    await openHome(engineRefusal(503, 'Busy'), { ...connected(), delayMs: 500 });
    const inNotice = present(noticeRefresh(), 'the notice’s Refresh');
    inNotice.focus();
    await click(inNotice);
    inNotice.blur();
    await advance(500);
    expect(connectionNotices()).toHaveLength(0);
    expect(document.activeElement).not.toBe(headerRefresh());
  });

  it.each<[string, FakeAnswer]>([
    ['an engine-error state', engineRefusal(503, 'Busy')],
    ['an unknown-reason state', emulatorDown('a_reason_studio_does_not_know')],
  ])('in %s, Tab reaches the notice’s "Refresh" and Enter on it sends a new check', async (_name, answer) => {
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
  ])('a check answers %s, the next 200 reachable: "Connected" and no notice', async (_name, answer) => {
    await openHome(answer, connected());
    expect(connectionNotices()).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1, name: 'Home' });
    await advance(5_000);
    expect(bothConnected()).toBe(true);
    expect(connectionNotices()).toHaveLength(0);
    // The same page: nothing was mounted afresh.
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBe(heading);
  });
});

describe('Home: leaving and returning', () => {
  it('sends no check after leaving Home, and starts checking again on return', async () => {
    const { router } = await openHome(connected());
    // Home is left for Studio's "Page not found", which asks the engine nothing; the AWS area checks the connection
    // itself every 5 seconds (issue 45, R4.4), so it is no page to leave Home for here.
    await act(() => router.navigate('/does-not-exist'));
    await advance();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
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
    const said = recordAnnouncements();
    await openHome(
      connected(),
      connected(),
      emulatorDown('not_started'),
      emulatorDown('not_started'),
      engineRefusal(503, 'Busy'),
    );
    const C = 'Engine connected. Emulator connected.';
    // Answers at 0, 5, 10, 15 and 20 seconds.
    expect(said).toEqual([C]);
    await advance(5_000);
    expect(said).toEqual([C]);
    await advance(5_000);
    expect(said).toEqual([C, 'Emulator not started.']);
    await advance(5_000);
    expect(said).toEqual([C, 'Emulator not started.']);
    await advance(5_000);
    expect(said).toEqual([C, 'Emulator not started.', 'Engine error: Busy.']);
  });
});

describe('Home: content', () => {
  it('shows the head with its description and "Refresh", then "Connection", then "Providers" with its counter', async () => {
    await openHome(connected());
    const main = screen.getByRole('main');
    const heading = within(main).getByRole('heading', { level: 1, name: 'Home' });
    expect(main).toHaveTextContent('A local console for your cloud emulators, through the EmuForge engine.');
    const refresh = headerRefresh();
    const connection = connectionSection();
    const providers = within(main).getByRole('region', { name: 'Providers (1)' });
    expect(within(providers).getByRole('heading', { level: 2 })).toHaveTextContent('Providers (1)');
    // In this order in the page.
    const order = [heading, refresh, connection, providers];
    for (let i = 1; i < order.length; i++) {
      const earlier = present(order[i - 1], 'an earlier part');
      expect(
        earlier.compareDocumentPosition(present(order[i], 'a later part')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    }
  });

  it('lists one provider: "Amazon Web Services" to /aws, "<number> services · <number> with a Studio screen", both numbers from the providers list, every service link (regression, issue 494)', async () => {
    const aws = present(PROVIDERS[0], 'the AWS entry');
    const count = aws.services.length;
    const screens = aws.services.filter(({ hasScreen }) => hasScreen).length;
    expect(screens).toBeGreaterThan(0);
    await openHome(connected());
    const providers = screen.getByRole('region', { name: 'Providers (1)' });
    const entry = within(providers).getByRole('link', { name: 'Amazon Web Services' });
    expect(entry).toHaveAttribute('href', '/aws');
    // As written in the page: U+00A0 between the count and its unit (issue 32, R4.1).
    expect(providerLine(providers).textContent).toBe(
      `${String(count)}\u00a0services · ${String(screens)} with a Studio screen`,
    );
    expect(providers).not.toHaveTextContent('no Studio screen yet');
    const links = within(providers)
      .getAllByRole('link')
      .filter((link) => link !== entry)
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual(SERVICES);
  });

  it.each<[string, FakeAnswer]>([
    ['checking', { hang: true }],
    ['connected', connected()],
    ['not started', emulatorDown('not_started')],
    ['killed', emulatorDown('connection_refused')],
    ['an unknown reason', emulatorDown('a_reason_studio_does_not_know')],
    ['engine unreachable', { network: true }],
    ['engine error', engineRefusal(503, 'Busy')],
  ])('%s: no element of the page outside the frame has a Cloudscape class', async (_name, answer) => {
    await openHome(answer);
    expect(cloudscapeElements(screen.getByRole('main'))).toEqual([]);
    expect(cloudscapeElements()).toEqual([]);
  });
});

describe("Home's providers line counts the services that have a Studio screen (issue 494, R2)", () => {
  it.each<[string, number, number, string]>([
    ['three services of which one has a screen', 3, 1, '3\u00a0services · 1 with a Studio screen'],
    ['one service that has a screen', 1, 1, '1\u00a0service · 1 with a Studio screen'],
    ['two services of which none has a screen', 2, 0, '2\u00a0services · no Studio screen yet'],
  ])('a provider of %s → "%s"', (_what, total, withScreen, line) => {
    const region = renderProvider(testServices(total, withScreen));
    expect(providerLine(region).textContent).toBe(line);
  });

  it('a provider of 1,234 services of which 1,000 have a screen, in German → both numbers as German writes them', () => {
    const region = renderProvider(testServices(1234, 1000), 'de');
    expect(providerLine(region).textContent).toBe('1.234\u00a0Dienste · 1.000 mit Studio-Ansicht');
  });

  it('every service link is still listed, each to its path, whether or not it has a screen', () => {
    const services = testServices(5, 2);
    const region = renderProvider(services);
    const links = within(region)
      .getAllByRole('link')
      .filter((link) => link.textContent !== 'Test Cloud')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual(services.map(({ label, path }) => [label, path]));
  });
});
