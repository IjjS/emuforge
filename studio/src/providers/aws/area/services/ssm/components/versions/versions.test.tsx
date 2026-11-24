import type {
  DescribeParametersCommandInput,
  GetParameterCommandInput,
  GetParameterHistoryCommandInput,
  LabelParameterVersionCommandInput,
  UnlabelParameterVersionCommandInput,
} from '@aws-sdk/client-ssm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../../lib/engine/engine-client';
import { creationDateText } from '../../../../components/format-date';
import AwsArea from '../../../../index';
import { PARAMETER_STORE_PATH, parameterPath } from '../../paths';

const NAME = '/app/database/password';
const OTHER = '/app/database/host';
const CURRENT = 'synthetic-current-value';
const OLDER = 'synthetic-version-one-value';
const HISTORY_VALUE = 'synthetic-value-from-history';
const MODIFIED = 1795485600;
const emulator = { port: 9308, endpoint: 'https://127.0.0.1:9308' };
const connected = { kind: 'connected', checkedAt: 1, target: 'local', emulator } as const;
const disconnected = {
  ...connected,
  kind: 'emulator-unreachable',
  checkedAt: 2,
  reason: 'not_started',
  message: '',
} as const;
const metadata = { Name: NAME, Version: 2, Type: 'SecureString' };
const first = { Version: 1, LastModifiedDate: MODIFIED - 60, Labels: ['stable'], Value: HISTORY_VALUE };
const second = { Version: 2, LastModifiedDate: MODIFIED, Labels: ['latest'], Value: HISTORY_VALUE };

const describeParameters = vi.fn<(input: DescribeParametersCommandInput) => Response | Promise<Response>>();
const getParameter = vi.fn<(input: GetParameterCommandInput) => Response | Promise<Response>>();
const getHistory = vi.fn<(input: GetParameterHistoryCommandInput) => Response | Promise<Response>>();
const addLabels = vi.fn<(input: LabelParameterVersionCommandInput) => Response>();
const removeLabels = vi.fn<(input: UnlabelParameterVersionCommandInput) => Response>();
let nextPort = 8760;
let engineOrigin: string;

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function denied(message: string) {
  return answer({ __type: 'AccessDeniedException', message }, 403);
}

function notImplemented() {
  return answer({ __type: 'NotImplemented' }, 501);
}

function history(rows = [first, second], token?: string) {
  return answer({ Parameters: rows, NextToken: token });
}

function value(Value: string) {
  return answer({ Parameter: { Value } });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    response,
    finish: async (reply: Response) => act(async () => resolve(reply)),
  };
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${nextPort++}`;
  describeParameters.mockReset().mockImplementation(({ ParameterFilters }) => {
    const parameters = [metadata, { Name: OTHER, Version: 1, Type: 'String' }];
    const name = ParameterFilters?.[0]?.Values?.[0];
    return answer({ Parameters: name === undefined ? parameters : parameters.filter(({ Name }) => Name === name) });
  });
  getParameter.mockReset().mockImplementation(({ Name }) => value(Name === `${NAME}:1` ? OLDER : CURRENT));
  getHistory.mockReset().mockImplementation(() => history());
  addLabels.mockReset().mockImplementation(({ ParameterVersion }) => answer({ ParameterVersion }));
  removeLabels.mockReset().mockImplementation(({ Labels }) => answer({ RemovedLabels: Labels }));
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const data: unknown = await request.json();
    switch (request.headers.get('x-amz-target')?.split('.').at(-1)) {
      case 'DescribeParameters':
        return describeParameters(data as DescribeParametersCommandInput);
      case 'GetParameter':
        return getParameter(data as GetParameterCommandInput);
      case 'GetParameterHistory':
        return getHistory(data as GetParameterHistoryCommandInput);
      case 'LabelParameterVersion':
        return addLabels(data as LabelParameterVersionCommandInput);
      case 'UnlabelParameterVersion':
        return removeLabels(data as UnlabelParameterVersionCommandInput);
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

function open() {
  const controls: { connect?: (result: CheckResult) => void } = {};
  function Frame() {
    const [result, setResult] = useState<CheckResult>(connected);
    useEffect(() => {
      controls.connect = setResult;
    }, []);
    return (
      <AwsArea
        connection={{ engineOrigin, result }}
        headerSelector="#top-bar"
        routeChanges={0}
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
      />
    );
  }
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], {
    initialEntries: [parameterPath(NAME)],
  });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    client,
    connect: (result: CheckResult) => act(() => controls.connect?.(result)),
    navigate: async (path: string) => act(async () => router.navigate(path)),
  };
}

const currentRegion = () => screen.findByRole('region', { name: 'Current value' });
const versionTable = () => screen.getByRole('table', { name: 'Parameter versions' });
const versionRegion = (version: number) => screen.getByRole('region', { name: `Version ${version} actions` });
const notification = () => screen.getByRole('list', { name: 'Notifications' });

function click(name: string, region: HTMLElement = document.body) {
  fireEvent.click(within(region).getByRole('button', { name }));
}

async function openHistory() {
  fireEvent.click(await screen.findByRole('button', { name: 'Version history' }));
  return screen.findByRole('table', { name: 'Parameter versions' });
}

async function selectVersion(version = 1) {
  const row = within(await screen.findByRole('table', { name: 'Parameter versions' }));
  fireEvent.click(await row.findByRole('radio', { name: `Version ${version}` }));
  return versionRegion(version);
}

async function labelDialog(action: 'Add labels' | 'Remove labels') {
  click(action, versionRegion(1));
  return screen.findByRole('dialog', { name: action });
}

function enterRemoval(dialog: HTMLElement, labels: string[]) {
  for (const label of labels) {
    fireEvent.click(within(dialog).getByRole('checkbox', { name: label }));
  }
}

describe('Parameter Store values and versions', () => {
  it('V1 requests only the explicitly revealed current or selected version value and hides it', async () => {
    open();
    const current = await currentRegion();
    expect(getParameter).not.toHaveBeenCalled();
    expect(getHistory).not.toHaveBeenCalled();

    click('Show value', current);
    expect(await within(current).findByText(CURRENT)).toBeVisible();
    expect(getParameter.mock.calls).toEqual([[{ Name: NAME, WithDecryption: true }]]);
    click('Hide value', current);
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();

    await openHistory();
    const version = await selectVersion();
    expect(getParameter).toHaveBeenCalledTimes(1);
    click('Show value', version);
    expect(await within(version).findByText(OLDER)).toBeVisible();
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();
    expect(getParameter).toHaveBeenLastCalledWith({ Name: `${NAME}:1`, WithDecryption: true });
    click('Hide value', version);
    expect(screen.queryByText(OLDER)).not.toBeInTheDocument();
  });

  it('V2 discards late replies after hiding, changing version, leaving, changing name, or switching target', async () => {
    const { connect, navigate } = open();
    const start = async (region: HTMLElement, name: string, secure = true) => {
      const late = deferredResponse();
      getParameter.mockClear().mockReturnValueOnce(late.response);
      click('Show value', region);
      await waitFor(() => expect(getParameter).toHaveBeenCalledWith({ Name: name, WithDecryption: secure }));
      return late;
    };
    const current = await currentRegion();
    const hidden = await start(current, NAME);
    click('Hide value', current);
    await hidden.finish(value(CURRENT));
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();

    await openHistory();
    const selected = await start(await selectVersion(), `${NAME}:1`);
    await selectVersion(2);
    await selected.finish(value(OLDER));
    expect(screen.queryByText(OLDER)).not.toBeInTheDocument();

    const left = await start(current, NAME);
    await navigate(PARAMETER_STORE_PATH);
    await left.finish(value(CURRENT));
    await navigate(parameterPath(NAME));
    expect(within(await currentRegion()).getByRole('button', { name: 'Show value' })).toBeEnabled();
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();

    const renamed = await start(await currentRegion(), NAME);
    await navigate(parameterPath(OTHER));
    await renamed.finish(value(CURRENT));
    expect(within(await currentRegion()).getByRole('button', { name: 'Show value' })).toBeEnabled();
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();

    const retargeted = await start(await currentRegion(), OTHER, false);
    connect({ ...connected, target: 'alternate', checkedAt: 2 });
    await retargeted.finish(value(CURRENT));
    expect(within(await currentRegion()).getByRole('button', { name: 'Show value' })).toBeEnabled();
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();
  });

  it('V3 clears visible and pending values on disconnect and reads only metadata on recovery', async () => {
    const { connect } = open();
    click('Show value', await currentRegion());
    expect(await screen.findByText(CURRENT)).toBeVisible();
    await openHistory();
    const late = deferredResponse();
    getParameter.mockReturnValueOnce(late.response);
    click('Show value', await selectVersion());
    await waitFor(() => expect(getParameter).toHaveBeenCalledTimes(2));

    connect(disconnected);
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();
    await late.finish(value(OLDER));
    expect(screen.queryByText(OLDER)).not.toBeInTheDocument();

    describeParameters.mockReturnValueOnce(answer({ Parameters: [] }));
    connect({ ...connected, checkedAt: 3 });
    expect(
      await screen.findByText(
        (_, element) => element?.tagName === 'P' && element.textContent === `Parameter ${NAME} was not found.`,
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Parameter Store' })).toBeVisible();
    expect(describeParameters).toHaveBeenCalledTimes(2);
    expect(getParameter).toHaveBeenCalledTimes(2);
    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(OLDER)).not.toBeInTheDocument();
  });

  it('V4 retries an access denial and shares a GetParameter 501 across both reveal controls', async () => {
    getParameter.mockReturnValueOnce(denied('Cannot reveal this value.')).mockReturnValueOnce(notImplemented());
    open();
    const current = await currentRegion();
    click('Show value', current);
    expect(await within(current).findByText(/Cannot reveal this value/)).toBeVisible();
    click('Retry', current);
    expect(
      await within(current).findByText('The emulator answered 501 Not Implemented for GetParameter.'),
    ).toBeVisible();
    expect(within(current).getByRole('button', { name: 'Show value' })).toBeDisabled();

    await openHistory();
    const version = await selectVersion();
    expect(within(version).getByRole('button', { name: 'Show value' })).toBeDisabled();
    expect(getHistory).toHaveBeenCalledOnce();
    expect(getParameter).toHaveBeenCalledTimes(2);
  });

  it('V5 reads pages by token with decryption off and keeps history values out of the view and cache', async () => {
    getHistory.mockReturnValueOnce(history([first], 'page-two')).mockReturnValueOnce(history([second]));
    const { client } = open();
    await openHistory();
    expect(await within(versionTable()).findByText('stable')).toBeVisible();
    expect(versionTable()).toHaveTextContent(creationDateText(new Date(first.LastModifiedDate * 1000)));
    expect(within(versionTable()).getByRole('rowheader', { name: '1' })).toBeVisible();
    click('Next page');
    expect(await within(versionTable()).findByText('latest')).toBeVisible();
    expect(versionTable()).toHaveTextContent(creationDateText(new Date(second.LastModifiedDate * 1000)));
    expect(within(versionTable()).getByRole('rowheader', { name: '2' })).toBeVisible();
    expect(within(versionTable()).queryByText('stable')).not.toBeInTheDocument();
    expect(getHistory.mock.calls).toEqual([
      [{ Name: NAME, WithDecryption: false, MaxResults: 50 }],
      [{ Name: NAME, WithDecryption: false, MaxResults: 50, NextToken: 'page-two' }],
    ]);
    expect(screen.queryByText(HISTORY_VALUE)).not.toBeInTheDocument();
    expect(JSON.stringify(client.getQueriesData({ queryKey: ['aws', 'ssm'] }))).not.toContain(HISTORY_VALUE);
    expect(getParameter).not.toHaveBeenCalled();
  });

  it('V6 preserves the updated selected version and outcome when history settles before metadata', async () => {
    const newLabel = { ...first, Labels: ['stable', 'release'] };
    getHistory.mockReturnValueOnce(history()).mockReturnValueOnce(history([newLabel, second]));
    const afterAdd = deferredResponse();
    const afterRemove = deferredResponse();
    open();
    await openHistory();
    await selectVersion();
    describeParameters.mockReturnValueOnce(afterAdd.response).mockReturnValueOnce(afterRemove.response);
    const add = await labelDialog('Add labels');
    fireEvent.change(within(add).getByRole('textbox', { name: 'Labels' }), { target: { value: 'release' } });
    click('Add labels', add);
    expect(await within(versionTable()).findByText('stable, release')).toBeVisible();
    expect(notification()).toHaveTextContent(`Added labels for ${NAME}, version 1: release.`);
    await afterAdd.finish(answer({ Parameters: [metadata] }));
    expect(within(versionTable()).getByText('stable, release')).toBeVisible();
    expect(notification()).toHaveTextContent('release.');
    expect(addLabels.mock.calls).toEqual([[{ Name: NAME, ParameterVersion: 1, Labels: ['release'] }]]);

    const remove = await labelDialog('Remove labels');
    enterRemoval(remove, ['release']);
    click('Remove labels', remove);
    expect(await within(versionTable()).findByText('stable')).toBeVisible();
    expect(notification()).toHaveTextContent(`Removed labels for ${NAME}, version 1: release.`);
    await afterRemove.finish(answer({ Parameters: [metadata] }));
    expect(within(versionTable()).getByText('stable')).toBeVisible();
    expect(notification()).toHaveTextContent('Removed labels');
    expect(removeLabels.mock.calls).toEqual([[{ Name: NAME, ParameterVersion: 1, Labels: ['release'] }]]);
    expect(describeParameters).toHaveBeenCalledTimes(3);
  });

  it('V7 distinguishes rejected labels from additions and removals and shows refreshed history', async () => {
    addLabels.mockReturnValueOnce(answer({ ParameterVersion: 1, InvalidLabels: ['reserved'] }));
    removeLabels.mockReturnValueOnce(answer({ RemovedLabels: ['release'], InvalidLabels: ['stable'] }));
    getHistory
      .mockReturnValueOnce(history())
      .mockReturnValueOnce(history([{ ...first, Labels: ['stable', 'release'] }, second]));
    open();
    await openHistory();
    await selectVersion();
    const add = await labelDialog('Add labels');
    fireEvent.change(within(add).getByRole('textbox', { name: 'Labels' }), {
      target: { value: 'release, reserved' },
    });
    click('Add labels', add);
    expect(await within(versionTable()).findByText('stable, release')).toBeVisible();
    expect(notification()).toHaveTextContent('version 1: release.');
    expect(notification()).toHaveTextContent('Rejected labels: reserved.');

    const remove = await labelDialog('Remove labels');
    enterRemoval(remove, ['release', 'stable']);
    click('Remove labels', remove);
    expect(await within(versionTable()).findByText('stable')).toBeVisible();
    expect(notification()).toHaveTextContent(`Removed labels for ${NAME}, version 1: release.`);
    expect(notification()).toHaveTextContent('Rejected labels: stable.');
    expect(removeLabels.mock.calls).toEqual([[{ Name: NAME, ParameterVersion: 1, Labels: ['release', 'stable'] }]]);
  });

  it.each([
    ['Add labels', 'LabelParameterVersion', 'Remove labels'],
    ['Remove labels', 'UnlabelParameterVersion', 'Add labels'],
  ] as const)('V8 disables only %s after a 501', async (action, operation, available) => {
    const adding = action === 'Add labels';
    (adding ? addLabels : removeLabels).mockReturnValueOnce(notImplemented());
    open();
    await openHistory();
    await selectVersion();
    const dialog = await labelDialog(action);
    if (adding) {
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Labels' }), { target: { value: 'release' } });
    } else {
      enterRemoval(dialog, ['stable']);
    }
    click(action, dialog);
    expect(await screen.findByText(`The emulator answered 501 Not Implemented for ${operation}.`)).toBeVisible();
    expect(within(versionRegion(1)).getByRole('button', { name: action })).toBeDisabled();
    expect(within(versionRegion(1)).getByRole('button', { name: available })).toBeEnabled();
    const otherVersion = await selectVersion(2);
    expect(within(otherVersion).getByRole('button', { name: action })).toBeDisabled();
    expect(within(otherVersion).getByRole('button', { name: available })).toBeEnabled();
  });

  it('V9 retries ordinary history errors and disables further history reads after 501', async () => {
    getHistory
      .mockReturnValueOnce(answer({ __type: 'ValidationException', message: 'History read failed.' }, 400))
      .mockReturnValueOnce(history([first], 'page-two'))
      .mockReturnValueOnce(notImplemented());
    open();
    await openHistory();
    expect(await screen.findByText(/History read failed\./)).toBeVisible();
    click('Retry');
    expect(await within(versionTable()).findByText('stable')).toBeVisible();
    click('Next page');
    expect(await screen.findByText('The emulator answered 501 Not Implemented for GetParameterHistory.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
    click('Version history');
    await openHistory();
    expect(getHistory).toHaveBeenCalledTimes(3);
    click('Show value', await currentRegion());
    expect(await screen.findByText(CURRENT)).toBeVisible();
  });

  it('V10 retains the label input after a refusal and allows a corrected submission', async () => {
    addLabels.mockReturnValueOnce(denied('Cannot attach that label.'));
    getHistory
      .mockReturnValueOnce(history())
      .mockReturnValueOnce(history([{ ...first, Labels: ['stable', 'release'] }, second]));
    open();
    await openHistory();
    await selectVersion();
    const dialog = await labelDialog('Add labels');
    const input = within(dialog).getByRole('textbox', { name: 'Labels' });
    fireEvent.change(input, { target: { value: 'blocked' } });
    click('Add labels', dialog);
    expect(await within(dialog).findByText(/Cannot attach that label/)).toBeVisible();
    expect(input).toHaveValue('blocked');
    expect(screen.queryByText(/Added labels for/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'release' } });
    click('Add labels', dialog);
    expect(await within(versionTable()).findByText('stable, release')).toBeVisible();
    expect(addLabels).toHaveBeenLastCalledWith({ Name: NAME, ParameterVersion: 1, Labels: ['release'] });
  });

  it('V11 retains the existing label after removal is denied and allows retrying', async () => {
    removeLabels.mockReturnValueOnce(denied('Cannot remove that label.'));
    getHistory.mockReturnValueOnce(history()).mockReturnValueOnce(history([{ ...first, Labels: [] }, second]));
    open();
    await openHistory();
    await selectVersion();
    const dialog = await labelDialog('Remove labels');
    enterRemoval(dialog, ['stable']);
    click('Remove labels', dialog);
    expect(await within(dialog).findByText(/Cannot remove that label/)).toBeVisible();
    expect(within(versionTable()).getByText('stable')).toBeInTheDocument();
    expect(screen.queryByText(/Removed labels for/)).not.toBeInTheDocument();

    click('Remove labels', dialog);
    await waitFor(() => expect(within(versionTable()).queryByText('stable')).not.toBeInTheDocument());
    expect(notification()).toHaveTextContent('Removed labels');
    expect(removeLabels.mock.calls).toEqual([
      [{ Name: NAME, ParameterVersion: 1, Labels: ['stable'] }],
      [{ Name: NAME, ParameterVersion: 1, Labels: ['stable'] }],
    ]);
  });
});
