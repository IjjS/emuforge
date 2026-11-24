import type { DescribeParametersCommandInput, PutParameterCommandInput } from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AwsArea from '../../../index';
import { PARAMETER_CREATE_PATH, PARAMETER_STORE_PATH, parameterEditPath, parameterPath } from '../paths';
import { useParameterListing } from '../queries';

const NAME = '/app/database/password';
const POLICY = { Type: 'Expiration', Attributes: { Timestamp: '2027-01-01T00:00:00Z' } };
const OTHER_POLICY = { Type: 'NoChangeNotification', Attributes: { After: '14', Unit: 'Days' } };
const NEXT_POLICY = { Type: 'Expiration', Attributes: { Timestamp: '2028-01-01T00:00:00Z' } };
const PARAMETER = {
  Name: NAME,
  ARN: 'arn:aws:ssm:us-east-1:000000000000:parameter/app/database/password',
  Type: 'SecureString',
  Version: 1,
  Description: 'Application password',
  KeyId: 'alias/app-key',
  Tier: 'Advanced',
  DataType: 'text',
  AllowedPattern: '[a-z]+',
  Policies: [POLICY, OTHER_POLICY].map((policy) => ({
    PolicyText: JSON.stringify(policy),
    PolicyType: policy.Type,
    PolicyStatus: 'Pending',
  })),
};
const FILTERS = [{ Key: 'Name', Option: 'Equals', Values: [NAME] }];
const CONNECTED = {
  kind: 'connected',
  checkedAt: 1,
  target: 'local',
  emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
} as const;

const describeParameters = vi.fn<(input: DescribeParametersCommandInput) => Response | Promise<Response>>();
const putParameter = vi.fn<(input: PutParameterCommandInput) => Response | Promise<Response>>();
const requests: string[] = [];
let nextPort = 8930;
let engineOrigin: string;

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { response, resolve };
}

beforeEach(() => {
  requests.length = 0;
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  describeParameters.mockReset().mockImplementation(() => answer({ Parameters: [PARAMETER] }));
  putParameter.mockReset().mockImplementation(() => answer({ Version: 2, Tier: 'Advanced' }));
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
    if (operation === undefined) throw new Error('Missing AWS operation');
    requests.push(operation);
    switch (operation) {
      case 'DescribeParameters':
        return describeParameters((await request.json()) as DescribeParametersCommandInput);
      case 'PutParameter':
        return putParameter((await request.json()) as PutParameterCommandInput);
      default:
        throw new Error(`Unexpected AWS request: ${operation}`);
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

function open(path: string, observeListing = false) {
  const client = new QueryClient();
  const connection = { engineOrigin, result: CONNECTED };
  function Listing() {
    const { items } = useParameterListing(connection);
    return <output aria-label="Observed listing">{items?.[0]?.Version ?? 'Pending'}</output>;
  }
  function Frame() {
    const { pathname } = useLocation();
    const visit = useRef({ pathname, count: 0 });
    const count = visit.current.count + Number(visit.current.pathname !== pathname);
    useLayoutEffect(() => {
      visit.current = { pathname, count };
    }, [pathname, count]);
    return (
      <>
        <AwsArea
          connection={connection}
          headerSelector="#top-bar"
          routeChanges={count}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
        {observeListing && <Listing />}
      </>
    );
  }
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { where: () => router.state.location.pathname + router.state.location.search };
}

const field = (name: string) => screen.getByLabelText(name, { exact: true });
const change = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name });
const create = () => button('Create parameter');
const save = () => button('Save changes');
const notifications = () => screen.queryByRole('list', { name: 'Notifications' });
const isMissing = (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === `Parameter ${NAME} was not found.`;

function select(label: string, value: string) {
  const control = createWrapper()
    .findAllFormFields()
    .find((candidate) => candidate.findLabel()?.getElement().textContent === label);
  const dropdown = control?.findControl()?.findSelect();
  if (!dropdown) throw new Error(`Missing select field ${label}`);
  act(() => dropdown.openDropdown());
  act(() => dropdown.selectOptionByValue(value));
}

async function openEdit() {
  const page = open(parameterEditPath(NAME));
  await screen.findByLabelText('New value');
  return page;
}

function fillCreate() {
  change('Name', NAME);
  change('Value', 'local-fixture');
}

describe('Parameter Store forms', () => {
  it('F1 opens routed forms from the list and detail and starts editing with no value', async () => {
    const { where } = open(PARAMETER_STORE_PATH);
    const entry = await screen.findByRole('link', { name: 'Create parameter' });
    expect(entry).toHaveAttribute('href', PARAMETER_CREATE_PATH);
    fireEvent.click(entry);
    expect(await screen.findByRole('heading', { name: 'Create parameter' })).toBeVisible();
    expect(where()).toBe(PARAMETER_CREATE_PATH);
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Breadcrumbs' }));
    for (const label of ['EmuForge', 'AWS', 'Systems Manager', 'Parameter Store']) {
      expect(crumbs().getByRole('link', { name: label })).toBeVisible();
    }
    expect(crumbs().getAllByText('Create parameter')[0]).toBeVisible();
    fireEvent.click(button('Cancel'));
    fireEvent.click(await screen.findByRole('link', { name: NAME }));
    expect(await screen.findByRole('heading', { name: 'Parameter details' })).toBeVisible();
    const edit = screen.getByRole('link', { name: 'Edit parameter' });
    expect(edit).toHaveAttribute('href', parameterEditPath(NAME));
    fireEvent.click(edit);
    expect(await screen.findByLabelText('New value')).toHaveValue('');
    expect(where()).toBe(parameterEditPath(NAME));
    expect(crumbs().getByRole('link', { name: NAME })).toHaveAttribute('href', parameterPath(NAME));
    expect(crumbs().getAllByText('Edit parameter')[0]).toBeVisible();
    expect(describeParameters).toHaveBeenLastCalledWith({ ParameterFilters: FILTERS });
    expect(field('Description')).toHaveValue(PARAMETER.Description);
    expect(requests.every((operation) => operation === 'DescribeParameters')).toBe(true);
  });

  it.each([
    ['String', 'literal value ', undefined],
    ['StringList', 'one,two,three', undefined],
    ['SecureString', 'default key\nvalue', undefined],
    ['SecureString', 'custom key value', 'alias/local-key'],
  ])('F2 creates %s with its original value and requested settings (%s)', async (type, value, key) => {
    open(PARAMETER_CREATE_PATH);
    change('Name', NAME);
    if (type !== 'String') select('Type', type);
    change('Value', value);
    const advanced = key !== undefined;
    if (advanced) {
      change('KMS key ID', key);
      change('Description', 'Service setting');
      change('Allowed pattern', '.*');
      select('Tier', 'Advanced');
      change('Parameter policies', JSON.stringify([POLICY], null, 2));
    } else if (type === 'SecureString') {
      expect(field('KMS key ID')).toHaveValue('');
    }
    fireEvent.click(create());
    await waitFor(() => expect(putParameter).toHaveBeenCalledTimes(1));
    expect(putParameter).toHaveBeenCalledWith({
      Name: NAME,
      Type: type,
      Value: value,
      Tier: advanced ? 'Advanced' : 'Standard',
      Overwrite: false,
      ...(advanced
        ? { KeyId: key, Description: 'Service setting', AllowedPattern: '.*', Policies: JSON.stringify([POLICY]) }
        : {}),
    });
    expect(await screen.findByRole('heading', { name: 'Parameter details' })).toBeVisible();
  });

  it('F3 shows field errors and never sends a missing name, missing value, or invalid policy', async () => {
    open(PARAMETER_CREATE_PATH);
    fireEvent.click(create());
    expect(screen.getByText('Enter a parameter name.')).toBeVisible();
    expect(screen.getByText('Enter a parameter value.')).toBeVisible();
    expect(putParameter).not.toHaveBeenCalled();
    fillCreate();
    select('Tier', 'Advanced');
    for (const text of ['[', '{}', '"policy"', '["policy"]']) {
      change('Parameter policies', text);
      fireEvent.click(create());
      expect(screen.getByText('Enter a JSON array of policy objects.')).toBeVisible();
      expect(putParameter).not.toHaveBeenCalled();
    }
  });

  it('F4 keeps or discards edits and returns immediately from an unchanged form', async () => {
    const { where } = await openEdit();
    change('Description', 'Edited description');
    fireEvent.click(button('Cancel'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Discard what you entered?' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Keep editing' }));
    expect(field('Description')).toHaveValue('Edited description');
    fireEvent.click(button('Cancel'));
    const reopened = within(await screen.findByRole('dialog', { name: 'Discard what you entered?' }));
    fireEvent.click(reopened.getByRole('button', { name: 'Discard' }));
    await screen.findByRole('heading', { name: 'Parameter details' });
    expect(where()).toBe(parameterPath(NAME));
    fireEvent.click(screen.getByRole('link', { name: 'Edit parameter' }));
    await screen.findByLabelText('New value');
    fireEvent.click(button('Cancel'));
    await screen.findByRole('heading', { name: 'Parameter details' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe(parameterPath(NAME));
    expect(putParameter).not.toHaveBeenCalled();
  });

  it('F5 preserves the attempted name and value when creation encounters a duplicate', async () => {
    putParameter.mockImplementation(() =>
      answer({ __type: 'ParameterAlreadyExists', message: 'This parameter name already exists.' }, 400),
    );
    const { where } = open(PARAMETER_CREATE_PATH);
    fillCreate();
    fireEvent.click(create());
    expect(await screen.findByText(/This parameter name already exists/)).toBeVisible();
    expect(field('Name')).toHaveValue(NAME);
    expect(field('Value')).toHaveValue('local-fixture');
    expect(putParameter).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ Overwrite: false }));
    expect(where()).toBe(PARAMETER_CREATE_PATH);
    expect(notifications()).toBeNull();
  });

  it('F6 saves changed settings and shows the fresh metadata with the next version', async () => {
    const description = 'Updated application password';
    putParameter.mockImplementation(() => {
      describeParameters.mockImplementation(() =>
        answer({
          Parameters: [
            {
              ...PARAMETER,
              Version: 2,
              Description: description,
              AllowedPattern: '[a-z0-9]+',
              Policies: [{ PolicyText: JSON.stringify(NEXT_POLICY), PolicyType: NEXT_POLICY.Type }],
            },
          ],
        }),
      );
      return answer({ Version: 2, Tier: 'Advanced' });
    });
    const { where } = await openEdit();
    change('New value', 'newvalue2');
    change('Description', description);
    change('Allowed pattern', '[a-z0-9]+');
    change('Parameter policies', JSON.stringify([NEXT_POLICY], null, 2));
    fireEvent.click(save());
    await screen.findByRole('heading', { name: 'Parameter details' });
    expect(screen.getByText(description)).toBeVisible();
    expect(screen.getByText('2', { exact: true })).toBeVisible();
    expect(screen.getByText('[a-z0-9]+')).toBeVisible();
    expect(screen.getByText(JSON.stringify(NEXT_POLICY))).toBeVisible();
    expect(where()).toBe(parameterPath(NAME));
    expect(putParameter).toHaveBeenCalledExactlyOnceWith({
      Name: NAME,
      Type: PARAMETER.Type,
      Tier: PARAMETER.Tier,
      KeyId: PARAMETER.KeyId,
      DataType: PARAMETER.DataType,
      Overwrite: true,
      Value: 'newvalue2',
      Description: description,
      AllowedPattern: '[a-z0-9]+',
      Policies: JSON.stringify([NEXT_POLICY]),
    });
  });

  it.each(['create', 'edit'])('F7 keeps the %s flash when detail settles before the refreshed list', async (mode) => {
    const editing = mode === 'edit';
    const list = pendingResponse();
    let written = false;
    describeParameters.mockImplementation(({ ParameterFilters }) => {
      if (written && ParameterFilters === undefined) return list.response;
      return answer({ Parameters: [{ ...PARAMETER, Version: written ? 2 : 1 }] });
    });
    putParameter.mockImplementation(() => {
      written = true;
      return answer({ Version: 2 });
    });
    const { where } = open(editing ? parameterEditPath(NAME) : PARAMETER_CREATE_PATH, true);
    await waitFor(() => expect(screen.getByLabelText('Observed listing')).toHaveTextContent(/^1$/));
    if (editing) change('New value', 'replacement');
    else fillCreate();
    fireEvent.click(editing ? save() : create());
    expect(await screen.findByRole('heading', { name: 'Parameter details' })).toBeVisible();
    expect(where()).toBe(parameterPath(NAME));
    expect(screen.getByText('2', { exact: true })).toBeVisible();
    expect(screen.getByLabelText('Observed listing')).toHaveTextContent('Pending');
    const message = `Parameter ${NAME} ${editing ? 'updated' : 'created'}.`;
    expect(notifications()).toHaveTextContent(message);
    await act(async () => list.resolve(answer({ Parameters: [{ ...PARAMETER, Version: 2 }] })));
    await waitFor(() => expect(screen.getByLabelText('Observed listing')).toHaveTextContent(/^2$/));
    expect(notifications()).toHaveTextContent(message);
    expect(putParameter).toHaveBeenCalledTimes(1);
  });

  it('F8 suppresses double submissions, permits retry on rejection and disables PutParameter on 501', async () => {
    const write = pendingResponse();
    putParameter
      .mockReturnValueOnce(write.response)
      .mockImplementationOnce(() => answer({ __type: 'NotImplemented' }, 501));
    open(PARAMETER_CREATE_PATH);
    fillCreate();
    const form = field('Name').closest('form');
    if (!form) throw new Error('Missing parameter form');
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(putParameter).toHaveBeenCalledTimes(1));
    expect(create()).toBeDisabled();
    await act(async () =>
      write.resolve(answer({ __type: 'AccessDeniedException', message: 'Writes are denied.' }, 403)),
    );
    expect(await screen.findByText(/Writes are denied/)).toBeVisible();
    expect(field('Value')).toHaveValue('local-fixture');
    expect(create()).toBeEnabled();
    fireEvent.click(create());
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText('The emulator answered 501 Not Implemented for PutParameter.')).toBeVisible();
    expect(create()).toBeDisabled();
    fireEvent.submit(form);
    expect(putParameter).toHaveBeenCalledTimes(2);
  });

  it('F9 has no save control when the exact name is missing at entry', async () => {
    describeParameters.mockImplementation(() => answer({ Parameters: [{ Name: `${NAME}-other` }] }));
    open(parameterEditPath(NAME));
    expect(await screen.findByText(isMissing)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Parameter Store' })).toHaveAttribute('href', PARAMETER_STORE_PATH);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(putParameter).not.toHaveBeenCalled();
  });

  it('F10 verifies every page before treating a parameter removed externally as missing', async () => {
    describeParameters
      .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }))
      .mockImplementationOnce(() => answer({ Parameters: [], NextToken: 'continue' }))
      .mockImplementationOnce(() => answer({ Parameters: [{ Name: `${NAME}-other` }] }));
    await openEdit();
    change('New value', 'replacement');
    fireEvent.click(save());
    expect(await screen.findByText(isMissing)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Parameter Store' })).toBeVisible();
    expect(describeParameters.mock.calls).toEqual([
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS, NextToken: 'continue' }],
    ]);
    expect(putParameter).not.toHaveBeenCalled();
    expect(notifications()).toBeNull();
  });

  it('F11 preserves both policy objects in order and untouched writable metadata on a value-only edit', async () => {
    await openEdit();
    expect(JSON.parse((field('Parameter policies') as HTMLTextAreaElement).value)).toEqual([POLICY, OTHER_POLICY]);
    change('New value', 'replacement');
    fireEvent.click(save());
    await screen.findByRole('heading', { name: 'Parameter details' });
    expect(putParameter).toHaveBeenCalledExactlyOnceWith({
      Name: NAME,
      Type: PARAMETER.Type,
      Tier: PARAMETER.Tier,
      KeyId: PARAMETER.KeyId,
      DataType: PARAMETER.DataType,
      Overwrite: true,
      Value: 'replacement',
      Description: PARAMETER.Description,
      AllowedPattern: PARAMETER.AllowedPattern,
      Policies: JSON.stringify([POLICY, OTHER_POLICY]),
    });
  });

  it('F12 preserves input when preflight fails and retries from page one before writing', async () => {
    describeParameters
      .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }))
      .mockImplementationOnce(() => answer({ Parameters: [], NextToken: 'failed-token' }))
      .mockImplementationOnce(() =>
        answer({ __type: 'ValidationException', message: 'Failed to read the next page.' }, 400),
      )
      .mockImplementationOnce(() => answer({ Parameters: [], NextToken: 'retry-token' }))
      .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }));
    const { where } = await openEdit();
    change('New value', 'replacement');
    change('Description', 'Buffered description');
    fireEvent.click(save());
    expect(await screen.findByText(/Failed to read the next page/)).toBeVisible();
    expect(field('New value')).toHaveValue('replacement');
    expect(field('Description')).toHaveValue('Buffered description');
    expect(putParameter).not.toHaveBeenCalled();
    expect(notifications()).toBeNull();
    expect(where()).toBe(parameterEditPath(NAME));

    fireEvent.click(save());
    await screen.findByRole('heading', { name: 'Parameter details' });
    expect(describeParameters.mock.calls.slice(0, 5)).toEqual([
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS, NextToken: 'failed-token' }],
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS, NextToken: 'retry-token' }],
    ]);
    expect(requests.slice(0, 6)).toEqual([...Array<string>(5).fill('DescribeParameters'), 'PutParameter']);
    expect(putParameter).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        Name: NAME,
        Value: 'replacement',
        Description: 'Buffered description',
        Overwrite: true,
      }),
    );
  });
});
