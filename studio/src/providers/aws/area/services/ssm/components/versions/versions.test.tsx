import type {
  DescribeParametersCommandInput,
  GetParameterCommandInput,
  GetParameterHistoryCommandInput,
  LabelParameterVersionCommandInput,
  UnlabelParameterVersionCommandInput,
} from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

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

const page = createWrapper(document.body);
const currentRegion = () => screen.findByRole('region', { name: 'Current value' });
const versionTable = () =>
  page.findAllTables().find((table) => table.find('table[aria-label="Parameter versions"]') !== null);
const versionRegion = (version: number) => screen.getByRole('region', { name: `Version ${version} actions` });
const pagination = () => versionTable()?.findPagination();
const historyEmpty = () => versionTable()?.findEmptySlot();
const flashItems = (type: 'success' | 'warning') => page.findFlashbar()?.findItemsByType(type) ?? [];
const flashContent = (type: 'success' | 'warning') => flashItems(type)[0]?.findContent()?.getElement();

function namedButton(name: string, region: HTMLElement) {
  const button = createWrapper(region)
    .findAllButtons()
    .find((candidate) => candidate.getElement().textContent?.trim() === name)
    ?.getElement();
  expect(button).toHaveAccessibleName(name);
  return button;
}

function click(name: string, region: HTMLElement) {
  const button = namedButton(name, region);
  assert(button);
  fireEvent.click(button);
}

function versionRow(version: number) {
  const table = versionTable();
  // The radio selection control occupies the first column.
  return (
    (table?.findRows() ?? []).findIndex(
      (_, index) => table?.findBodyCell(index + 1, 2)?.getElement().textContent === String(version),
    ) + 1
  );
}

function labelCell(version: number) {
  return versionTable()?.findBodyCell(versionRow(version), 4)?.getElement();
}

function expectLabels(version: number, labels: string) {
  const cell = labelCell(version);
  expect(cell).toBeVisible();
  expect(cell?.textContent).toBe(labels);
}

function toggleHistory() {
  const section = page
    .findAllExpandableSections()
    .find((candidate) => candidate.findHeaderText()?.getElement().textContent === 'Version history');
  const toggle = section?.findExpandButton().getElement();
  assert(toggle);
  expect(toggle).toHaveAccessibleName('Version history');
  fireEvent.click(toggle);
}

async function openHistory() {
  await currentRegion();
  toggleHistory();
  await waitFor(() => expect(versionTable()?.getElement()).toBeVisible());
}

async function selectVersion(version = 1) {
  const radio = await waitFor(() => {
    const selection = versionTable()?.findRowSelectionArea(versionRow(version))?.getElement();
    assert(selection);
    return within(selection).getByRole('radio', { name: `Version ${version}` });
  });
  fireEvent.click(radio);
  return versionRegion(version);
}

async function labelDialog(action: 'Add labels' | 'Remove labels') {
  click(action, versionRegion(1));
  return waitFor(() => {
    const modal = page.findModal();
    assert(modal);
    expect(modal.findHeader().getElement()).toHaveTextContent(action);
    expect(modal.getElement()).toBeVisible();
    expect(modal.getElement()).toHaveAccessibleName(action);
    return modal;
  });
}

type LabelDialog = Awaited<ReturnType<typeof labelDialog>>;

function labelInput(dialog: LabelDialog) {
  const input = dialog.findContent().findInput()?.findNativeInput().getElement();
  assert(input);
  expect(input).toHaveAccessibleName('Labels');
  return input;
}

function submitLabels(dialog: LabelDialog, action: 'Add labels' | 'Remove labels') {
  const footer = dialog.findFooter()?.getElement();
  assert(footer);
  click(action, footer);
}

function enterRemoval(dialog: LabelDialog, labels: string[]) {
  const checkboxes = dialog.findContent().findAllCheckboxes();
  for (const label of labels) {
    const checkbox = checkboxes.find((candidate) => candidate.findLabel().getElement().textContent === label);
    assert(checkbox);
    const input = checkbox.findNativeInput().getElement();
    expect(input).toHaveAccessibleName(label);
    fireEvent.click(input);
  }
}

function changePage(direction: 'next' | 'previous') {
  const control = pagination();
  assert(control);
  const button = direction === 'next' ? control.findNextPageButton() : control.findPreviousPageButton();
  expect(button.getElement()).toHaveAccessibleName(direction === 'next' ? 'Next page' : 'Previous page');
  fireEvent.click(button.getElement());
}

describe('Parameter Store values and versions', () => {
  it('places the current value reveal before the metadata fields', async () => {
    open();
    const current = await currentRegion();
    expect(namedButton('Show value', current)).toBeVisible();
    expect(current.compareDocumentPosition(screen.getByText('ARN'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(getParameter).not.toHaveBeenCalled();
  });

  it('omits pagination when all versions are on one page', async () => {
    open();
    await openHistory();
    await waitFor(() => expectLabels(1, 'stable'));
    expect(pagination()).toBeNull();
  });

  it('keeps the previous page available on the final page', async () => {
    getHistory
      .mockReturnValueOnce(history([first], 'page-two'))
      .mockReturnValueOnce(history([second]))
      .mockReturnValueOnce(history([first], 'page-two'));
    open();
    await openHistory();
    await waitFor(() => expectLabels(1, 'stable'));
    changePage('next');
    await waitFor(() => expectLabels(2, 'latest'));
    changePage('previous');
    await waitFor(() => expectLabels(1, 'stable'));
    expect(getHistory).toHaveBeenLastCalledWith({ Name: NAME, WithDecryption: false, MaxResults: 50 });
  });

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
    expect(namedButton('Show value', await currentRegion())).toBeEnabled();
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();

    const renamed = await start(await currentRegion(), NAME);
    await navigate(parameterPath(OTHER));
    await renamed.finish(value(CURRENT));
    expect(namedButton('Show value', await currentRegion())).toBeEnabled();
    expect(screen.queryByText(CURRENT)).not.toBeInTheDocument();

    const retargeted = await start(await currentRegion(), OTHER, false);
    connect({ ...connected, target: 'alternate', checkedAt: 2 });
    await retargeted.finish(value(CURRENT));
    expect(namedButton('Show value', await currentRegion())).toBeEnabled();
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
    expect(namedButton('Retry', current)).toBeEnabled();
    click('Retry', current);
    expect(
      await within(current).findByText('The emulator answered 501 Not Implemented for GetParameter.'),
    ).toBeVisible();
    expect(createWrapper(current).findStatusIndicator()?.getElement()).toHaveTextContent(
      'Not implemented by the emulator',
    );
    const retry = namedButton('Retry', current);
    expect(retry).toBeVisible();
    expect(retry).toBeDisabled();
    expect(namedButton('Show value', current)).toBeDisabled();
    await act(async () => {
      click('Retry', current);
      click('Show value', current);
    });

    await openHistory();
    await waitFor(() => expectLabels(1, 'stable'));
    for (const version of [1, 2]) {
      const region = await selectVersion(version);
      expect(namedButton('Show value', region)).toBeDisabled();
      await act(async () => click('Show value', region));
    }
    expect(getHistory).toHaveBeenCalledOnce();
    expect(getHistory).toHaveBeenCalledWith({ Name: NAME, MaxResults: 50, WithDecryption: false });
    expect(getParameter.mock.calls).toEqual([
      [{ Name: NAME, WithDecryption: true }],
      [{ Name: NAME, WithDecryption: true }],
    ]);
  });

  it('V5 reads pages by token with decryption off and keeps history values out of the view and cache', async () => {
    getHistory.mockReturnValueOnce(history([first], 'page-two')).mockReturnValueOnce(history([second]));
    const { client } = open();
    await openHistory();
    await waitFor(() => expectLabels(1, 'stable'));
    const firstVersion = versionTable()?.findBodyCell(1, 2)?.getElement();
    expect(firstVersion).toBeVisible();
    expect(firstVersion).toHaveAccessibleName('1');
    expect(versionTable()?.findBodyCell(1, 3)?.getElement()).toHaveTextContent(
      creationDateText(new Date(first.LastModifiedDate * 1000)),
    );
    changePage('next');
    await waitFor(() => expectLabels(2, 'latest'));
    const secondVersion = versionTable()?.findBodyCell(1, 2)?.getElement();
    expect(secondVersion).toBeVisible();
    expect(secondVersion).toHaveAccessibleName('2');
    expect(versionTable()?.findBodyCell(1, 3)?.getElement()).toHaveTextContent(
      creationDateText(new Date(second.LastModifiedDate * 1000)),
    );
    expect(versionTable()?.findRows()).toHaveLength(1);
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
    fireEvent.change(labelInput(add), { target: { value: 'release' } });
    submitLabels(add, 'Add labels');
    await waitFor(() => expectLabels(1, 'stable, release'));
    expect(flashContent('success')).toHaveTextContent(`Added labels for ${NAME}, version 1: release.`);
    await afterAdd.finish(answer({ Parameters: [metadata] }));
    expectLabels(1, 'stable, release');
    expect(flashContent('success')).toHaveTextContent('release.');
    expect(addLabels.mock.calls).toEqual([[{ Name: NAME, ParameterVersion: 1, Labels: ['release'] }]]);

    const remove = await labelDialog('Remove labels');
    enterRemoval(remove, ['release']);
    submitLabels(remove, 'Remove labels');
    await waitFor(() => expectLabels(1, 'stable'));
    expect(flashContent('success')).toHaveTextContent(`Removed labels for ${NAME}, version 1: release.`);
    await afterRemove.finish(answer({ Parameters: [metadata] }));
    expectLabels(1, 'stable');
    expect(flashContent('success')).toHaveTextContent('Removed labels');
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
    fireEvent.change(labelInput(add), {
      target: { value: 'release, reserved' },
    });
    submitLabels(add, 'Add labels');
    await waitFor(() => expectLabels(1, 'stable, release'));
    expect(flashContent('warning')).toHaveTextContent(`Added labels for ${NAME}, version 1: release.`);
    expect(flashContent('warning')).toHaveTextContent('Rejected labels: reserved.');

    const remove = await labelDialog('Remove labels');
    enterRemoval(remove, ['release', 'stable']);
    submitLabels(remove, 'Remove labels');
    await waitFor(() => expectLabels(1, 'stable'));
    expect(flashContent('warning')).toHaveTextContent(`Removed labels for ${NAME}, version 1: release.`);
    expect(flashContent('warning')).toHaveTextContent('Rejected labels: stable.');
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
      fireEvent.change(labelInput(dialog), { target: { value: 'release' } });
    } else {
      enterRemoval(dialog, ['stable']);
    }
    submitLabels(dialog, action);
    expect(
      await within(versionRegion(1)).findByText(`The emulator answered 501 Not Implemented for ${operation}.`),
    ).toBeVisible();
    expect(namedButton(action, versionRegion(1))).toBeDisabled();
    expect(namedButton(available, versionRegion(1))).toBeEnabled();
    const otherVersion = await selectVersion(2);
    expect(namedButton(action, otherVersion)).toBeDisabled();
    expect(namedButton(available, otherVersion)).toBeEnabled();
  });

  it('V9 retries ordinary history errors and disables further history reads after 501', async () => {
    getHistory
      .mockReturnValueOnce(answer({ __type: 'ValidationException', message: 'History read failed.' }, 400))
      .mockReturnValueOnce(history([first], 'page-two'))
      .mockReturnValueOnce(notImplemented());
    open();
    await openHistory();
    await waitFor(() => {
      const empty = historyEmpty()?.getElement();
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent(/History read failed\./);
    });
    const retry = historyEmpty()?.findButton()?.getElement();
    assert(retry);
    expect(retry).toHaveAccessibleName('Retry');
    fireEvent.click(retry);
    await waitFor(() => expectLabels(1, 'stable'));
    changePage('next');
    await waitFor(() => {
      const empty = historyEmpty()?.getElement();
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent('The emulator answered 501 Not Implemented for GetParameterHistory.');
    });
    expect(historyEmpty()?.findButton()?.getElement()).toBeDisabled();
    expect(pagination()?.findPreviousPageButton().getElement()).toHaveAttribute('aria-disabled', 'true');
    toggleHistory();
    await openHistory();
    expect(getHistory).toHaveBeenCalledTimes(3);
    click('Show value', await currentRegion());
    expect(await screen.findByText(CURRENT)).toBeVisible();
  });

  it('retains the selected history page and its actions after a successful label write refresh returns 501', async () => {
    const refresh = deferredResponse();
    getHistory
      .mockReturnValueOnce(history([second], 'page-two'))
      .mockReturnValueOnce(history([first], 'page-three'))
      .mockReturnValueOnce(refresh.response);
    const { navigate, connect } = open();
    await openHistory();
    await waitFor(() => expectLabels(2, 'latest'));
    changePage('next');
    await selectVersion();
    expectLabels(1, 'stable');

    const add = await labelDialog('Add labels');
    fireEvent.change(labelInput(add), { target: { value: 'release' } });
    submitLabels(add, 'Add labels');
    await waitFor(() => {
      expect(flashContent('success')).toHaveTextContent(`Added labels for ${NAME}, version 1: release.`);
      expect(getHistory).toHaveBeenCalledTimes(3);
    });
    expect(addLabels.mock.invocationCallOrder[0]).toBeLessThan(getHistory.mock.invocationCallOrder[2]);
    await refresh.finish(notImplemented());

    const refusal = 'The emulator answered 501 Not Implemented for GetParameterHistory.';
    expect(await screen.findByText(refusal)).toBeVisible();
    expectLabels(1, 'stable');
    expect(versionTable()?.findRows()).toHaveLength(1);
    const selection = versionTable()?.findRowSelectionArea(versionRow(1))?.getElement();
    assert(selection);
    expect(within(selection).getByRole('radio', { name: 'Version 1' })).toBeChecked();

    const retry = namedButton('Retry', document.body);
    expect(retry).toBeDisabled();
    expect(pagination()?.findPreviousPageButton().getElement()).toHaveAttribute('aria-disabled', 'true');
    expect(pagination()?.findNextPageButton().getElement()).toHaveAttribute('aria-disabled', 'true');
    click('Retry', document.body);
    changePage('previous');
    changePage('next');

    expect(getParameter).not.toHaveBeenCalled();
    expect(screen.queryByText(HISTORY_VALUE)).not.toBeInTheDocument();
    const version = versionRegion(1);
    click('Show value', version);
    expect(await within(version).findByText(OLDER)).toBeVisible();
    expect(getParameter.mock.calls).toEqual([[{ Name: `${NAME}:1`, WithDecryption: true }]]);
    click('Hide value', version);
    expect(screen.queryByText(OLDER)).not.toBeInTheDocument();

    const addAgain = await labelDialog('Add labels');
    fireEvent.change(labelInput(addAgain), { target: { value: 'candidate' } });
    submitLabels(addAgain, 'Add labels');
    await waitFor(() =>
      expect(flashContent('success')).toHaveTextContent(`Added labels for ${NAME}, version 1: candidate.`),
    );
    expect(addLabels.mock.calls).toEqual([
      [{ Name: NAME, ParameterVersion: 1, Labels: ['release'] }],
      [{ Name: NAME, ParameterVersion: 1, Labels: ['candidate'] }],
    ]);
    expect(getHistory.mock.calls).toEqual([
      [{ Name: NAME, WithDecryption: false, MaxResults: 50 }],
      [{ Name: NAME, WithDecryption: false, MaxResults: 50, NextToken: 'page-two' }],
      [{ Name: NAME, WithDecryption: false, MaxResults: 50, NextToken: 'page-two' }],
    ]);

    await navigate(parameterPath(OTHER));
    await openHistory();
    expect(await screen.findByText(refusal)).toBeVisible();
    expect(versionTable()?.findRows()).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Version 1 actions' })).not.toBeInTheDocument();
    expect(getHistory).toHaveBeenCalledTimes(3);

    getHistory.mockReturnValueOnce(history([{ ...second, Labels: ['alternate'] }]));
    await navigate(parameterPath(NAME));
    connect({ ...connected, target: 'alternate', checkedAt: 2 });
    await openHistory();
    await waitFor(() => expectLabels(2, 'alternate'));
    expect(screen.queryByText(refusal)).not.toBeInTheDocument();
    expect(versionTable()?.findRows()).toHaveLength(1);
    expect(versionRow(1)).toBe(0);
    expect(screen.queryByRole('region', { name: 'Version 1 actions' })).not.toBeInTheDocument();
    expect(getHistory).toHaveBeenCalledTimes(4);
    expect(getHistory).toHaveBeenLastCalledWith({ Name: NAME, WithDecryption: false, MaxResults: 50 });
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
    const input = labelInput(dialog);
    fireEvent.change(input, { target: { value: 'blocked' } });
    submitLabels(dialog, 'Add labels');
    await waitFor(() => {
      const message = dialog.findContent().findAlert()?.findContent().getElement();
      expect(message).toBeVisible();
      expect(message).toHaveTextContent(/Cannot attach that label/);
    });
    expect(input).toHaveValue('blocked');
    const notifications = page.findFlashbar()?.findItems() ?? [];
    expect(notifications.map((item) => item.findContent()?.getElement().textContent).join('\n')).not.toContain(
      'Added labels for',
    );

    fireEvent.change(input, { target: { value: 'release' } });
    submitLabels(dialog, 'Add labels');
    await waitFor(() => expectLabels(1, 'stable, release'));
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
    submitLabels(dialog, 'Remove labels');
    await waitFor(() => {
      const message = dialog.findContent().findAlert()?.findContent().getElement();
      expect(message).toBeVisible();
      expect(message).toHaveTextContent(/Cannot remove that label/);
    });
    expectLabels(1, 'stable');
    const notifications = page.findFlashbar()?.findItems() ?? [];
    expect(notifications.map((item) => item.findContent()?.getElement().textContent).join('\n')).not.toContain(
      'Removed labels for',
    );

    submitLabels(dialog, 'Remove labels');
    await waitFor(() => expectLabels(1, '-'));
    expect(flashContent('success')).toHaveTextContent('Removed labels');
    expect(removeLabels.mock.calls).toEqual([
      [{ Name: NAME, ParameterVersion: 1, Labels: ['stable'] }],
      [{ Name: NAME, ParameterVersion: 1, Labels: ['stable'] }],
    ]);
  });
});
