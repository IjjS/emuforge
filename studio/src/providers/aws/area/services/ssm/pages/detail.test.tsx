import type { DescribeParametersCommandInput } from '@aws-sdk/client-ssm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import { PARAMETER_STORE_PATH, parameterPath } from '../paths';

const NAME = '/app/database/password';
const ARN = 'arn:aws:ssm:us-east-1:000000000000:parameter/app/database/password';
const USER = 'arn:aws:iam::000000000000:user/developer';
const POLICY = '{"Type":"Expiration","Attributes":{"Timestamp":"2027-01-01T00:00:00Z"}}';
const VALUE = 'synthetic-parameter-value';
const MODIFIED = 1795485600;
const PARAMETER = {
  Name: NAME,
  ARN,
  Type: 'SecureString',
  Version: 12,
  Description: 'Application password',
  LastModifiedUser: USER,
  LastModifiedDate: MODIFIED,
  KeyId: 'alias/app-key',
  Tier: 'Advanced',
  DataType: 'text',
  AllowedPattern: '[a-z]+',
  Policies: [{ PolicyText: POLICY, PolicyType: 'Expiration', PolicyStatus: 'Pending' }],
  Value: VALUE,
};
const emulator = { port: 9308, endpoint: 'https://127.0.0.1:9308' };
const connected = { kind: 'connected', checkedAt: 1, target: 'local', emulator } as const;

const describeParameters = vi.fn<(input: DescribeParametersCommandInput) => Response | Promise<Response>>();
const deleteParameter = vi.fn<(input: { Name: string }) => Response>();
let nextPort = 8850;
let engineOrigin: string;

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  describeParameters.mockReset().mockImplementation(() => answer({ Parameters: [PARAMETER] }));
  deleteParameter.mockReset().mockImplementation(() => answer({}));
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    switch (request.headers.get('x-amz-target')?.split('.').at(-1)) {
      case 'DescribeParameters':
        return describeParameters((await request.json()) as DescribeParametersCommandInput);
      case 'DeleteParameter':
        return deleteParameter((await request.json()) as { Name: string });
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

function open(waitForList?: () => Promise<unknown>) {
  const controls: { connect?: (result: CheckResult) => void } = {};
  function Frame() {
    const { pathname } = useLocation();
    const [result, setResult] = useState<CheckResult>(connected);
    useEffect(() => {
      controls.connect = setResult;
    }, []);
    return (
      <AwsArea
        connection={{ engineOrigin, result }}
        headerSelector="#top-bar"
        routeChanges={pathname === PARAMETER_STORE_PATH ? 1 : 0}
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
      />
    );
  }
  const router = createMemoryRouter(
    [
      {
        path: '/aws/*',
        Component: Frame,
        HydrateFallback: () => null,
        shouldRevalidate: () => true,
        loader: ({ request }) =>
          new URL(request.url).pathname === PARAMETER_STORE_PATH && waitForList ? waitForList() : null,
      },
    ],
    { initialEntries: [parameterPath(NAME)] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    router,
    connect: (result: CheckResult) => act(() => controls.connect?.(result)),
  };
}

const parameterFilters = [{ Key: 'Name', Option: 'Equals', Values: [NAME] }];
const deleteButton = () => screen.getByRole('button', { name: 'Delete' });
const details = () => screen.findByRole('heading', { name: 'Parameter details' });

async function openDelete() {
  await details();
  fireEvent.click(deleteButton());
  return within(await screen.findByRole('dialog', { name: 'Delete parameter' }));
}

function confirm(dialog: ReturnType<typeof within>, text: string) {
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

describe('Parameter Store detail', () => {
  it('D1 reads exact-name metadata and displays the fields without the value', async () => {
    describeParameters.mockImplementation(() =>
      answer({
        Parameters: [{ Name: `${NAME}-other`, Description: 'Prefix match only' }, PARAMETER],
      }),
    );
    open();
    expect(await screen.findByRole('heading', { level: 1, name: NAME })).toBeVisible();
    await details();
    expect(describeParameters.mock.calls).toEqual([[{ ParameterFilters: parameterFilters }]]);
    for (const value of [
      'SecureString',
      '12',
      'Application password',
      'Advanced',
      'text',
      '[a-z]+',
      'Expiration',
      'Pending',
      POLICY,
    ]) {
      expect(screen.getByText(value)).toBeVisible();
    }
    for (const value of [ARN, USER, 'alias/app-key', creationDateText(new Date(MODIFIED * 1000))]) {
      expect(
        screen.getByText((_, element) =>
          Boolean(element?.classList.contains('aws-area-value') && element.textContent === value),
        ),
      ).toBeVisible();
    }
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(screen.queryByText('Prefix match only')).toBeNull();
  });

  it('D2 shows a name-specific missing state and each connection recovery path', async () => {
    describeParameters.mockImplementation(() => answer({ Parameters: [{ Name: `${NAME}-other` }] }));
    const { connect } = open();
    expect(
      await screen.findByText(
        (_, element) => element?.tagName === 'P' && element.textContent === `Parameter ${NAME} was not found.`,
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Parameter Store' })).toHaveAttribute('href', PARAMETER_STORE_PATH);

    connect({ kind: 'engine-unreachable', checkedAt: 2, lastEmulatorPort: emulator.port });
    expect(screen.getAllByText(/is not answering/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Connection status' })[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();

    connect({ ...connected, kind: 'emulator-unreachable', checkedAt: 3, reason: 'not_started', message: '' });
    expect(screen.getAllByText(/Not started on port/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Connection status' })[0]).toBeVisible();
  });

  it('D3 confirms the whole name and hands the deletion flash to the list after metadata settles', async () => {
    let finishNavigation!: (value: null) => void;
    const navigation = new Promise<null>((resolve) => {
      finishNavigation = resolve;
    });
    let deleted = false;
    describeParameters.mockImplementation(() => answer({ Parameters: deleted ? [] : [PARAMETER] }));
    deleteParameter.mockImplementation(() => {
      deleted = true;
      return answer({});
    });
    const { router } = open(() => navigation);
    const dialog = await openDelete();
    expect(dialog.getByText(/removes this parameter and its versions from your local emulator/)).toBeVisible();
    expect(dialog.getByText(`To confirm, type “${NAME}” in the field.`)).toBeVisible();
    confirm(dialog, NAME.slice(1));
    expect(deleteParameter).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(await details()).toBeVisible();
    expect(deleteParameter).not.toHaveBeenCalled();

    confirm(await openDelete(), NAME);
    expect(
      await screen.findByText(
        (_, element) => element?.tagName === 'P' && element.textContent === `Parameter ${NAME} was not found.`,
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).not.toBe(PARAMETER_STORE_PATH);
    await act(async () => finishNavigation(null));
    expect(await screen.findByRole('heading', { name: 'Parameter Store', level: 1 })).toBeVisible();
    expect(screen.getByRole('list', { name: 'Notifications' })).toHaveTextContent(`Parameter ${NAME} deleted.`);
    expect(deleteParameter.mock.calls).toEqual([[{ Name: NAME }]]);
  });

  it('D4 keeps access denial retryable and makes only DeleteParameter unavailable on 501', async () => {
    deleteParameter
      .mockReturnValueOnce(answer({ __type: 'AccessDeniedException', message: 'Denied for this parameter.' }, 403))
      .mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
    open();
    const dialog = await openDelete();
    confirm(dialog, NAME);
    expect(await dialog.findByText(/Denied for this parameter/)).toBeVisible();
    expect(dialog.getByRole('textbox')).toHaveValue(NAME);
    const retry = dialog.getByRole('button', { name: 'Delete' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(await screen.findByText('The emulator answered 501 Not Implemented for DeleteParameter.')).toBeVisible();
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(deleteButton()).toBeDisabled();
    expect(await details()).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeEnabled();
    expect(deleteParameter).toHaveBeenCalledTimes(2);
  });

  it('D5 follows the exact-name token even when the first page is empty', async () => {
    let finishPage!: (response: Response) => void;
    const page = new Promise<Response>((resolve) => {
      finishPage = resolve;
    });
    describeParameters
      .mockImplementationOnce(() => answer({ Parameters: [], NextToken: 'continue' }))
      .mockReturnValueOnce(page);
    open();
    await waitFor(() =>
      expect(describeParameters.mock.calls).toEqual([
        [{ ParameterFilters: parameterFilters }],
        [{ ParameterFilters: parameterFilters, NextToken: 'continue' }],
      ]),
    );
    expect(screen.queryByText(/was not found/)).toBeNull();
    expect(screen.getByText('Loading parameter…')).toBeVisible();
    finishPage(answer({ Parameters: [PARAMETER] }));
    expect(await details()).toBeVisible();
  });
});
