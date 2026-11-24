import type { DescribeParametersCommandInput } from '@aws-sdk/client-ssm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import { PARAMETER_STORE_PATH, parameterPath } from '../paths';
import { useParameterMetadata } from '../queries';

const FIRST = '/app/database';
const SECOND = '/app/worker';
const emulator = { port: 9308, endpoint: 'https://127.0.0.1:9308' };
const connected = { kind: 'connected', emulator, target: 'local', checkedAt: 1 } as const;
const modified = 1795485600;

interface DeleteInput {
  Name?: string;
  Names?: string[];
}

const read = vi.fn<(input: DescribeParametersCommandInput, signal: AbortSignal) => Response | Promise<Response>>();
const remove = vi.fn<(input: DeleteInput, operation: string) => Response>();
let nextPort = 8750;
let engineOrigin: string;

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function parameter(Name: string, Version = 1) {
  return { Name, Type: 'String', Version, LastModifiedDate: modified };
}

function page(names: string[], NextToken?: string) {
  return answer({ Parameters: names.map((name) => parameter(name)), NextToken });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  read.mockReset().mockImplementation(() => page([FIRST, SECOND]));
  remove.mockReset().mockImplementation(() => answer({}));
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1);
    switch (operation) {
      case 'DescribeParameters':
        return read((await request.json()) as DescribeParametersCommandInput, request.signal);
      case 'DeleteParameter':
      case 'DeleteParameters':
        return remove((await request.json()) as DeleteInput, operation);
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

function MetadataObserver({ connection }: { connection: AreaConnection }) {
  const query = useParameterMetadata(connection, FIRST);
  return query.metadata === null ? <div>Observed metadata is empty</div> : null;
}

function open(observeMetadata = false) {
  const controls: { connect?: (result: CheckResult) => void } = {};
  function Frame() {
    const [result, setResult] = useState<CheckResult>(connected);
    controls.connect = setResult;
    const connection = { engineOrigin, result };
    return (
      <>
        <AwsArea
          connection={connection}
          headerSelector="#top-bar"
          routeChanges={0}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
        {observeMetadata && <MetadataObserver connection={connection} />}
      </>
    );
  }
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [PARAMETER_STORE_PATH] });
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

const button = (name: string) => screen.getByRole('button', { name });
const row = (name: string) => screen.findByRole('link', { name });
const select = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));

async function deleteDialog(names: string[]) {
  for (const name of names) {
    await row(name);
    select(name);
  }
  fireEvent.click(button('Delete'));
  return within(await screen.findByRole('dialog'));
}

function confirm(dialog: ReturnType<typeof within>, text: string) {
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

describe('Parameter Store list', () => {
  it('L1 shows loading, then the empty title and guidance', async () => {
    const response = deferred();
    read.mockReturnValue(response.promise);
    open();
    expect(await screen.findByText('Loading parameters…')).toBeVisible();
    response.resolve(page([]));
    expect(await screen.findByText('No parameters')).toBeVisible();
    expect(screen.getByText('Create a parameter to store a configuration value.')).toBeVisible();
  });

  it('L2 reads current metadata on entry, return and first-page Refresh', async () => {
    let version = 1;
    read.mockImplementation(({ NextToken }) =>
      NextToken === undefined ? answer({ Parameters: [parameter(FIRST, version)], NextToken: 'next' }) : page([SECOND]),
    );
    const { router } = open();
    const link = await row(FIRST);
    expect(link).toHaveAttribute('href', parameterPath(FIRST));
    const entry = within(link.closest('tr')!);
    expect(entry.getByText('String')).toBeVisible();
    expect(entry.getByText('1')).toBeVisible();
    expect(entry.getByRole('cell', { name: creationDateText(new Date(modified * 1000)) })).toBeVisible();

    await act(() => router.navigate('/aws'));
    version = 2;
    await act(() => router.navigate(PARAMETER_STORE_PATH));
    expect(within((await row(FIRST)).closest('tr')!).getByText('2')).toBeVisible();
    fireEvent.click(button('Next page'));
    await row(SECOND);
    version = 3;
    fireEvent.click(button('Refresh'));
    expect(within((await row(FIRST)).closest('tr')!).getByText('3')).toBeVisible();
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, undefined, 'next', undefined]);
  });

  it('L3 follows tokens, clears selection, and continues through an empty page', async () => {
    read.mockImplementation(({ NextToken }) => {
      if (NextToken === 'through-empty') return page([SECOND]);
      return NextToken === 'next' ? page([], 'through-empty') : page([FIRST], 'next');
    });
    open();
    await row(FIRST);
    select(FIRST);
    expect(button('Delete')).toBeEnabled();
    fireEvent.click(button('Next page'));
    await screen.findByText('No parameters on this page');
    expect(button('Delete')).toBeDisabled();
    expect(button('Next page')).toBeEnabled();
    fireEvent.click(button('Next page'));
    await row(SECOND);
    expect(screen.getByRole('checkbox', { name: `Select ${SECOND}` })).not.toBeChecked();
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, 'next', 'through-empty']);
  });

  it('L4 retries a read failure and gives the engine reason for access denial', async () => {
    read
      .mockReturnValueOnce(answer({ __type: 'ValidationException', message: 'The listing failed.' }, 400))
      .mockReturnValueOnce(page([FIRST]))
      .mockReturnValueOnce(
        answer({ __type: 'AccessDeniedException', message: 'Listing was denied by the engine.' }, 403),
      );
    open();
    expect(await screen.findByText(/The listing failed/)).toBeVisible();
    fireEvent.click(button('Retry'));
    await row(FIRST);
    fireEvent.click(button('Refresh'));
    expect(await screen.findByText(/Listing was denied by the engine/)).toBeVisible();
  });

  it('L5 shows the DescribeParameters 501 and disables its read controls', async () => {
    read.mockReturnValueOnce(page([FIRST], 'next')).mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
    open();
    await row(FIRST);
    fireEvent.click(button('Next page'));
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for DescribeParameters/)).toBeVisible();
    for (const name of ['Refresh', 'Retry']) {
      expect(button(name)).toBeDisabled();
      fireEvent.click(button(name));
    }
    for (const name of ['Previous page', 'Next page', 'Page 1']) {
      expect(button(name)).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button(name));
    }
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('L6 lists the selected names and requires exact confirmation before sending a delete', async () => {
    open();
    const dialog = await deleteDialog([FIRST, SECOND]);
    expect(dialog.getByText(FIRST)).toBeVisible();
    expect(dialog.getByText(SECOND)).toBeVisible();
    expect(dialog.getByText(/their versions from your local emulator/)).toBeVisible();
    expect(dialog.getByText(/type .delete. in the field/)).toBeVisible();
    confirm(dialog, 'Delete');
    expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('L7 keeps the separate outcome while metadata and the list reconcile independently', async () => {
    const refreshedList = deferred();
    let deleted = false;
    read.mockImplementation(({ ParameterFilters }) => {
      if (ParameterFilters) return page(deleted ? [] : [FIRST]);
      return deleted ? refreshedList.promise : page([FIRST, SECOND]);
    });
    remove.mockImplementation(() => {
      deleted = true;
      return answer({ DeletedParameters: [FIRST], InvalidParameters: [SECOND] });
    });
    open(true);
    const dialog = await deleteDialog([FIRST, SECOND]);
    await waitFor(() => expect(read.mock.calls.some(([input]) => input.ParameterFilters !== undefined)).toBe(true));
    confirm(dialog, 'delete');
    expect(await screen.findByText('Observed metadata is empty')).toBeVisible();
    expect(screen.getByText('Deleted parameters')).toBeVisible();
    expect(screen.getByText('Rejected parameters')).toBeVisible();
    expect(remove).toHaveBeenCalledWith({ Names: [FIRST, SECOND] }, 'DeleteParameters');
    refreshedList.resolve(page([SECOND]));
    await row(SECOND);
    const results = within(screen.getByRole('list', { name: /notifications/i }));
    expect(results.getByText(FIRST)).toBeVisible();
    expect(results.getByText(SECOND)).toBeVisible();
    expect(screen.queryByRole('link', { name: FIRST })).toBeNull();
  });

  it('L8 preserves completed batches and disables only bulk delete after a 501', async () => {
    const names = Array.from({ length: 12 }, (_, index) => `/batch/item-${String(index)}`);
    read.mockReturnValueOnce(page(names)).mockImplementation(() => page(names.slice(10)));
    remove
      .mockReturnValueOnce(answer({ DeletedParameters: names.slice(0, 10) }))
      .mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
    open();
    const dialog = await deleteDialog(names);
    confirm(dialog, 'delete');
    expect(await screen.findByText('Deletion not confirmed')).toBeVisible();
    expect(screen.getByText('Deleted parameters')).toBeVisible();
    expect(screen.getByText('The emulator answered 501 Not Implemented for DeleteParameters.')).toBeVisible();
    expect(remove.mock.calls).toEqual([
      [{ Names: names.slice(0, 10) }, 'DeleteParameters'],
      [{ Names: names.slice(10) }, 'DeleteParameters'],
    ]);
    const results = within(screen.getByRole('list', { name: /notifications/i }));
    for (const name of names) expect(results.getByText(name)).toBeVisible();
    await row(names[10]!);
    select(names[10]!);
    expect(button('Delete')).toBeEnabled();
    select(names[11]!);
    expect(button('Delete')).toBeDisabled();
  });

  it('L9 discards the in-flight page and selection on disconnect and reconnects from page one', async () => {
    const oldPage = deferred();
    read
      .mockReturnValueOnce(page([FIRST], 'next'))
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(page(['/app/reconnected']));
    const { connect } = open();
    await row(FIRST);
    select(FIRST);
    fireEvent.click(button('Next page'));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    connect({ ...connected, kind: 'emulator-unreachable', reason: 'not_started', message: '', checkedAt: 2 });
    expect(button('Delete')).toBeDisabled();
    connect({ ...connected, checkedAt: 3 });
    await row('/app/reconnected');
    await act(async () => oldPage.resolve(page(['/app/late'])));
    expect(screen.queryByRole('link', { name: '/app/late' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select /app/reconnected' })).not.toBeChecked();
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, 'next', undefined]);
  });

  it('L10 invalidates every page on deletion and follows only the fresh first-page token', async () => {
    read
      .mockReturnValueOnce(page([FIRST], 'old-next'))
      .mockReturnValueOnce(answer({ Parameters: [parameter(SECOND, 2)] }))
      .mockReturnValueOnce(page([FIRST], 'old-next'))
      .mockReturnValueOnce(page(['/app/remaining'], 'new-next'))
      .mockReturnValueOnce(answer({ Parameters: [parameter(SECOND, 3)] }));
    open();
    await row(FIRST);
    fireEvent.click(button('Next page'));
    expect(within((await row(SECOND)).closest('tr')!).getByText('2')).toBeVisible();
    fireEvent.click(button('Previous page'));
    confirm(await deleteDialog([FIRST]), FIRST);
    await row('/app/remaining');
    expect(remove).toHaveBeenCalledWith({ Name: FIRST }, 'DeleteParameter');
    fireEvent.click(button('Next page'));
    expect(within((await row(SECOND)).closest('tr')!).getByText('3')).toBeVisible();
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([
      undefined,
      'old-next',
      undefined,
      undefined,
      'new-next',
    ]);
  });
});
