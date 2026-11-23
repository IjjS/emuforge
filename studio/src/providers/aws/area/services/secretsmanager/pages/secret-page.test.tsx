import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { SECRETS_MANAGER_PATH, SECRETS_PATH, secretPath } from '../paths';

const NAME = 'app/credentials';
const VALUE = '  synthetic  credential\nline two  ';
const DESCRIPTION = 'An existing secret description';
const HIDDEN = 'Secret value is hidden.';
const EMULATOR = { port: 9308, endpoint: 'https://127.0.0.1:9308' };

interface SecretInput {
  SecretId?: string;
  VersionId?: string;
}

let nextPort = 8750;
let engineOrigin: string;
const list = vi.fn<() => Response>();
const describeSecret = vi.fn<(input: SecretInput) => Response>();
const retrieve = vi.fn<(input: SecretInput, signal: AbortSignal) => Response | Promise<Response>>();

function connected(): Extract<CheckResult, { kind: 'connected' }> {
  return { kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR };
}

function disconnected(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: EMULATOR,
    reason: 'not_started',
    message: '',
  };
}

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function notFound() {
  return answer({ __type: 'ResourceNotFoundException', message: 'The secret does not exist.' }, 404);
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  list.mockReset().mockImplementation(() => answer({ SecretList: [{ Name: NAME, Description: DESCRIPTION }] }));
  describeSecret.mockReset().mockImplementation(({ SecretId }) =>
    answer({
      Name: SecretId,
      ARN: `arn:aws:secretsmanager:us-east-1:000000000000:secret:${SecretId ?? ''}`,
      Description: DESCRIPTION,
    }),
  );
  retrieve.mockReset().mockImplementation(() => answer({ SecretString: VALUE }));
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const body = (await request.json()) as SecretInput;
    switch (request.headers.get('x-amz-target')?.split('.').at(-1)) {
      case 'ListSecrets':
        return list();
      case 'DescribeSecret':
        return describeSecret(body);
      case 'GetSecretValue':
        return retrieve(body, request.signal);
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

function open(path = secretPath(NAME)) {
  const initial: AreaConnection = { engineOrigin, result: connected() };
  const controls: { update?: (value: { connection: AreaConnection; generation: number }) => void } = {};
  function Frame() {
    const [{ connection, generation }, update] = useState({ connection: initial, generation: 0 });
    controls.update = update;
    return (
      <AwsArea
        headerSelector="#top-bar"
        connection={connection}
        targetGeneration={generation}
        routeChanges={0}
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
      />
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    router,
    connect(result: CheckResult, generation = 0) {
      act(() => controls.update?.({ connection: { ...initial, result }, generation }));
    },
  };
}

const UI = createWrapper(document.body);

function pageHeader() {
  return UI.findHeader();
}

function section(heading: string) {
  return UI.findAllContainers().find(
    (container) => container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === heading,
  );
}

function alert(heading: string) {
  return UI.findAllAlerts().find((item) => item.findHeader()?.getElement().textContent === heading);
}

function description() {
  return section('Secret details')
    ?.findContent()
    .findKeyValuePairs()
    ?.findItems()
    .flatMap((group) => group.findGroupPairs() ?? [])
    .find((pair) => pair.findLabel()?.getElement().textContent === 'Description')
    ?.findValue()
    ?.getElement();
}

function valueContent() {
  return section('Secret value')?.findContent().getElement();
}

function valueButton() {
  return section('Secret value')?.findHeader()?.findHeader()?.findActions()?.findButton()?.getElement();
}

function refreshButton() {
  return pageHeader()?.findActions()?.findButton()?.getElement();
}

function retryButton() {
  return UI.findAllContainers()
    .find((container) => container.findHeader() === null)
    ?.findContent()
    .findButton()
    ?.getElement();
}

function click(button: HTMLElement | undefined) {
  if (button === undefined) throw new Error('Missing control');
  fireEvent.click(button);
}

function expectHeading(heading: string) {
  return waitFor(() => expect(pageHeader()?.findHeadingText().getElement()).toHaveTextContent(heading));
}

async function requestValue() {
  await waitFor(() => expect(valueButton()).toHaveAccessibleName('Retrieve secret value'));
  click(valueButton());
  await waitFor(() => expect(retrieve).toHaveBeenCalledTimes(1));
  const call = retrieve.mock.calls[0];
  expect(call?.[0].SecretId).toBe(NAME);
  return call?.[1];
}

function hideValue() {
  expect(valueButton()).toHaveAccessibleName('Hide secret value');
  click(valueButton());
}

async function shownValue() {
  return waitFor(() => {
    const content = valueContent();
    if (content === undefined) throw new Error('Missing secret value section');
    return within(content).getByText(VALUE, { normalizer: (text) => text });
  });
}

describe('Secret details and value', () => {
  it('uses the original slash-containing name in the heading, last crumb, and DescribeSecret', async () => {
    open('/aws/secretsmanager/secrets/detail?name=app%2Fcredentials');
    await expectHeading(NAME);
    const lastCrumb = UI.findBreadcrumbGroup()?.findBreadcrumbLinks().at(-1)?.getElement();
    expect(lastCrumb).toHaveTextContent(NAME);
    expect(lastCrumb?.closest('[aria-current="page"]')).toBeInTheDocument();
    await waitFor(() => expect(description()).toHaveTextContent(DESCRIPTION));
    expect(describeSecret).toHaveBeenCalledExactlyOnceWith({ SecretId: NAME });
  });

  it('shows the not-found message and link for a missing name', async () => {
    describeSecret.mockImplementation(notFound);
    open();
    await waitFor(() => expect(alert('Secret not found')?.getElement()).toBeVisible());
    const content = alert('Secret not found')?.findContent();
    expect(content?.getElement()).toHaveTextContent(`Your local emulator could not find ${NAME}.`);
    const back = content?.findLink()?.getElement();
    expect(back).toHaveAccessibleName('Back to secrets');
    expect(back).toHaveAttribute('href', SECRETS_PATH);
  });

  it('does not read the value on either page or on a metadata refresh', async () => {
    open(SECRETS_MANAGER_PATH);
    const link = () => UI.findTable()?.findBodyCell(1, 1)?.findLink()?.getElement();
    await waitFor(() => expect(link()).toHaveAccessibleName(NAME));
    click(link());
    await waitFor(() => expect(valueContent()).toHaveTextContent(HIDDEN));
    describeSecret.mockImplementation(() => answer({ Name: NAME, Description: 'Refreshed description' }));
    click(refreshButton());
    await waitFor(() => expect(description()).toHaveTextContent('Refreshed description'));
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('shows the retrieved string with its original whitespace', async () => {
    open();
    await requestValue();
    expect((await shownValue()).textContent).toBe(VALUE);
  });

  it('shows the exact Base64 encoding and label for binary bytes', async () => {
    retrieve.mockImplementation(() => answer({ SecretBinary: 'AAD/f4A=' }));
    open();
    await requestValue();
    await waitFor(() => expect(valueContent()).toHaveTextContent('Base64'));
    expect(valueContent()).toHaveTextContent('AAD/f4A=');
  });

  it('clears the shown value when hidden', async () => {
    open();
    await requestValue();
    const value = await shownValue();
    hideValue();
    expect(valueContent()).toHaveTextContent(HIDDEN);
    expect(value).not.toBeInTheDocument();
  });

  it('discards an in-flight value reply after hiding', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    open();
    const signal = await requestValue();
    hideValue();
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'late value' })));
    expect(valueContent()).toHaveTextContent(HIDDEN);
    expect(screen.queryByText('late value')).not.toBeInTheDocument();
  });

  it('discards an in-flight value reply after changing the name in the query', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    const { router } = open();
    const signal = await requestValue();
    await act(async () => router.navigate(secretPath('another/secret')));
    await expectHeading('another/secret');
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'previous name value' })));
    await waitFor(() => expect(valueContent()).toHaveTextContent(HIDDEN));
    expect(screen.queryByText('previous name value')).not.toBeInTheDocument();
  });

  it('discards an in-flight value reply after switching target on the same engine', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    const { connect } = open();
    const signal = await requestValue();
    connect({ ...connected(), target: 'another-target' }, 1);
    await waitFor(() => expect(valueContent()).toHaveTextContent(HIDDEN));
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'previous target value' })));
    expect(screen.queryByText('previous target value')).not.toBeInTheDocument();
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it('shows the reason for a refused value request while keeping the value hidden', async () => {
    retrieve.mockImplementation(() =>
      answer({ __type: 'AccessDeniedException', message: 'Reading denied by the local policy' }, 403),
    );
    open();
    await requestValue();
    await waitFor(() =>
      expect(alert('Access denied')?.findContent()?.getElement()).toHaveTextContent(
        'GetSecretValue was refused: Reading denied by the local policy',
      ),
    );
    expect(valueContent()).toHaveTextContent(HIDDEN);
    expect(valueButton()).toHaveAccessibleName('Retrieve secret value');
    expect(valueButton()).toBeEnabled();
  });

  it('immediately hides a revealed value when the connection is lost', async () => {
    const { connect } = open();
    await requestValue();
    const value = await shownValue();
    connect(disconnected());
    expect(value).not.toBeInTheDocument();
  });

  it('cancels a pending value request on disconnect and discards the late value', async () => {
    const late = deferredResponse();
    retrieve.mockImplementation(() => late.promise);
    const { connect } = open();
    const signal = await requestValue();
    connect(disconnected());
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve(answer({ SecretString: 'value after disconnect' })));
    expect(screen.queryByText('value after disconnect')).not.toBeInTheDocument();
  });

  it('automatically reads details after reconnect and only shows the missing result if the secret is gone', async () => {
    const { connect } = open();
    await waitFor(() => expect(description()).toHaveTextContent(DESCRIPTION));
    const oldDescription = description();
    await requestValue();
    const value = await shownValue();
    connect(disconnected());
    describeSecret.mockImplementation(notFound);
    connect(connected());
    await waitFor(() => expect(alert('Secret not found')?.getElement()).toBeVisible());
    const content = alert('Secret not found')?.findContent();
    expect(content?.getElement()).toHaveTextContent(`Your local emulator could not find ${NAME}.`);
    expect(content?.findLink()?.getElement()).toHaveAccessibleName('Back to secrets');
    expect(oldDescription).not.toBeInTheDocument();
    expect(value).not.toBeInTheDocument();
    expect(describeSecret).toHaveBeenCalledTimes(2);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it.each(['Retry', 'Refresh'] as const)(
    'recovers with %s before the next health poll and keeps the prior value hidden',
    async (action) => {
      const { connect } = open();
      await requestValue();
      const oldValue = await shownValue();
      connect(disconnected());
      expect(oldValue).not.toBeInTheDocument();
      expect(description()).toBeUndefined();
      expect(describeSecret).toHaveBeenCalledTimes(1);
      describeSecret.mockImplementation(() => answer({ Name: NAME, Description: 'Read before the next poll' }));

      const button = action === 'Retry' ? retryButton() : refreshButton();
      expect(button).toHaveAccessibleName(action);
      expect(button).toBeEnabled();
      click(button);
      await waitFor(() => expect(description()).toHaveTextContent('Read before the next poll'));
      expect(valueContent()).toHaveTextContent(HIDDEN);
      expect(describeSecret).toHaveBeenCalledTimes(2);
      expect(retrieve).toHaveBeenCalledTimes(1);
    },
  );

  it('shows a DescribeSecret 501 from a manual retry and leaves both controls disabled', async () => {
    const { connect } = open();
    await waitFor(() => expect(description()).toHaveTextContent(DESCRIPTION));
    connect(disconnected());
    describeSecret.mockImplementation(() => answer({ __type: 'NotImplemented', message: 'Unavailable' }, 501));
    click(retryButton());
    await waitFor(() =>
      expect(alert('Not implemented by the emulator')?.findContent()?.getElement()).toHaveTextContent(
        'The emulator answered 501 Not Implemented for DescribeSecret',
      ),
    );
    const retry = alert('Not implemented by the emulator')?.findActionSlot()?.findButton()?.getElement();
    for (const button of [retry, refreshButton()]) {
      expect(button).toBeDisabled();
      click(button);
    }
    expect(describeSecret).toHaveBeenCalledTimes(2);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
