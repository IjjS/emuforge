import type { DescribeParametersCommandInput, PutParameterCommandInput } from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
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
const DISCONNECTED = [
  { kind: 'engine-unreachable', checkedAt: 2, lastEmulatorPort: CONNECTED.emulator.port },
  { ...CONNECTED, kind: 'emulator-unreachable', checkedAt: 2, reason: 'not_started', message: '' },
] as const satisfies readonly CheckResult[];

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
  const controls: { connect?: (result: CheckResult) => void } = {};
  function Listing({ result }: { result: CheckResult }) {
    const connection = { engineOrigin, result };
    const { items } = useParameterListing(connection);
    return <output aria-label="Observed listing">{items?.[0]?.Version ?? 'Pending'}</output>;
  }
  function Frame() {
    const { pathname } = useLocation();
    const [result, setResult] = useState<CheckResult>(CONNECTED);
    const visit = useRef({ pathname, count: 0 });
    const count = visit.current.count + Number(visit.current.pathname !== pathname);
    useLayoutEffect(() => {
      visit.current = { pathname, count };
    }, [pathname, count]);
    useLayoutEffect(() => {
      controls.connect = setResult;
    }, []);
    return (
      <>
        <AwsArea
          connection={{ engineOrigin, result }}
          headerSelector="#top-bar"
          routeChanges={count}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
        {observeListing && <Listing result={result} />}
      </>
    );
  }
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    where: () => router.state.location.pathname + router.state.location.search,
    connect: (result: CheckResult) => act(() => controls.connect?.(result)),
  };
}

const ui = createWrapper();

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

const formField = (name: string) =>
  ui.findAllFormFields().find((candidate) => candidate.findLabel()?.getElement().textContent === name);
const field = (name: string) => {
  const control = formField(name)?.findControl();
  return required(
    control?.findInput()?.findNativeInput().getElement() ?? control?.findTextarea()?.findNativeTextarea().getElement(),
    `input for ${name}`,
  );
};
const change = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const fieldError = (name: string) => formField(name)?.findError()?.getElement();
const formButton = (name: string) =>
  within(required(ui.findForm()?.findActions()?.getElement(), 'form actions')).getByRole('button', { name });
const create = () => formButton('Create parameter');
const save = () => formButton('Save changes');
const notifications = () => ui.findFlashbar()?.findItems() ?? [];
const success = () => ui.findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement();
const heading = (name: string) =>
  ui
    .findAllHeaders()
    .map((header) => header.findHeadingText().getElement())
    .find((element) => element.textContent === name);
const visibleHeading = (name: string) => waitFor(() => expect(heading(name)).toBeVisible());
const detailValue = (label: string) =>
  ui
    .findAllKeyValuePairs()
    .flatMap((pairs) => pairs.findItems())
    .find((pair) => pair.findLabel()?.getElement().textContent === label)
    ?.findValue()
    ?.getElement();
const alertContent = () => ui.findForm()?.findContent()?.findAlert()?.findContent().getElement();
const isMissing = (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === `Parameter ${NAME} was not found.`;

function select(label: string, value: string) {
  const dropdown = required(formField(label)?.findControl()?.findSelect(), `select field ${label}`);
  act(() => dropdown.openDropdown());
  act(() => dropdown.selectOptionByValue(value));
}

async function discardButton(name: string) {
  return waitFor(() => {
    const dialog = required(ui.findModal(), 'discard dialog');
    expect(dialog.isVisible()).toBe(true);
    expect(dialog.findHeader().getElement()).toHaveTextContent(/^Discard what you entered\?$/);
    return within(required(dialog.findFooter()?.getElement(), 'discard actions')).getByRole('button', { name });
  });
}

async function openEdit() {
  const page = open(parameterEditPath(NAME));
  await waitFor(() => expect(field('New value')).toBeVisible());
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
    await visibleHeading('Create parameter');
    expect(where()).toBe(PARAMETER_CREATE_PATH);
    const crumb = (index: number) => ui.findBreadcrumbGroup()?.findBreadcrumbLink(index)?.getElement();
    for (const [index, label] of ['EmuForge', 'AWS', 'Systems Manager', 'Parameter Store'].entries()) {
      expect(crumb(index + 1)).toHaveTextContent(label);
      expect(crumb(index + 1)).toBeVisible();
    }
    expect(crumb(5)).toHaveTextContent('Create parameter');
    fireEvent.click(formButton('Cancel'));
    fireEvent.click(await screen.findByRole('link', { name: NAME }));
    await visibleHeading('Parameter details');
    const edit = screen.getByRole('link', { name: 'Edit parameter' });
    expect(edit).toHaveAttribute('href', parameterEditPath(NAME));
    fireEvent.click(edit);
    await waitFor(() => expect(field('New value')).toHaveValue(''));
    expect(field('New value')).toHaveAccessibleDescription(
      /Enter a new value for every save\. Saving creates a new version\./,
    );
    expect(where()).toBe(parameterEditPath(NAME));
    expect(crumb(5)).toHaveTextContent(NAME);
    expect(crumb(5)).toHaveAttribute('href', parameterPath(NAME));
    expect(crumb(6)).toHaveTextContent('Edit parameter');
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
    await visibleHeading('Parameter details');
  });

  it('F3 reveals the first invalid create input and preserves the draft without sending it', () => {
    open(PARAMETER_CREATE_PATH);
    const revealName = vi.fn();
    Object.defineProperty(field('Name'), 'scrollIntoView', { value: revealName });
    fireEvent.click(create());
    expect(fieldError('Name')).toHaveTextContent('Enter a parameter name.');
    expect(fieldError('Value')).toHaveTextContent('Enter a parameter value.');
    expect(revealName).toHaveBeenCalledWith({ block: 'center' });
    expect(field('Name')).toHaveFocus();
    expect(field('Name')).toHaveAccessibleDescription(/Enter a parameter name\./);
    expect(putParameter).not.toHaveBeenCalled();
    fillCreate();
    expect(formField('Tier')?.findDescription()?.getElement()).toHaveTextContent(
      'Choose Advanced to configure parameter policies.',
    );
    select('Tier', 'Advanced');
    for (const text of ['[', '{}', '"policy"', '["policy"]']) {
      change('Parameter policies', text);
      fireEvent.click(create());
      expect(fieldError('Parameter policies')).toHaveTextContent('Enter a JSON array of policy objects.');
      expect(field('Parameter policies')).toHaveFocus();
      expect(field('Parameter policies')).toHaveAccessibleDescription(/Enter a JSON array of policy objects\./);
      expect(field('Parameter policies')).toHaveValue(text);
      expect(field('Value')).toHaveValue('local-fixture');
      expect(putParameter).not.toHaveBeenCalled();
    }
  });

  it('reveals New value on invalid edit submit and preserves the settings draft', async () => {
    await openEdit();
    change('Description', 'Edited description');
    change('Parameter policies', '[');
    const value = field('New value');
    const revealValue = vi.fn();
    Object.defineProperty(value, 'scrollIntoView', { value: revealValue });
    save().focus();
    fireEvent.click(save());
    expect(revealValue).toHaveBeenCalledWith({ block: 'center' });
    expect(value).toHaveFocus();
    expect(fieldError('New value')).toHaveTextContent('Enter a parameter value.');
    expect(value).toHaveAccessibleDescription(/Enter a parameter value\./);
    expect(field('Description')).toHaveValue('Edited description');
    expect(field('Parameter policies')).toHaveValue('[');
    expect(requests).toEqual(['DescribeParameters']);
  });

  it('F4 keeps or discards edits and returns immediately from an unchanged form', async () => {
    const { where } = await openEdit();
    change('Description', 'Edited description');
    fireEvent.click(formButton('Cancel'));
    fireEvent.click(await discardButton('Keep editing'));
    expect(field('Description')).toHaveValue('Edited description');
    fireEvent.click(formButton('Cancel'));
    fireEvent.click(await discardButton('Discard'));
    await visibleHeading('Parameter details');
    expect(where()).toBe(parameterPath(NAME));
    fireEvent.click(screen.getByRole('link', { name: 'Edit parameter' }));
    await waitFor(() => expect(field('New value')).toBeVisible());
    fireEvent.click(formButton('Cancel'));
    await visibleHeading('Parameter details');
    expect(ui.findModal()).toBeNull();
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
    await waitFor(() => expect(alertContent()).toHaveTextContent('This parameter name already exists.'));
    expect(field('Name')).toHaveValue(NAME);
    expect(field('Value')).toHaveValue('local-fixture');
    expect(putParameter).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ Overwrite: false }));
    expect(where()).toBe(PARAMETER_CREATE_PATH);
    expect(notifications()).toHaveLength(0);
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
    await visibleHeading('Parameter details');
    expect(detailValue('Description')).toHaveTextContent(description);
    expect(detailValue('Version')).toHaveTextContent(/^2$/);
    expect(detailValue('Allowed pattern')).toHaveTextContent('[a-z0-9]+');
    expect(screen.getByText(JSON.stringify(NEXT_POLICY, null, 2), { normalizer: (text) => text })).toBeVisible();
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
    await visibleHeading('Parameter details');
    expect(where()).toBe(parameterPath(NAME));
    expect(detailValue('Version')).toHaveTextContent(/^2$/);
    expect(screen.getByLabelText('Observed listing')).toHaveTextContent('Pending');
    const message = `Parameter ${NAME} ${editing ? 'updated' : 'created'}.`;
    expect(success()).toHaveTextContent(message);
    await act(async () => list.resolve(answer({ Parameters: [{ ...PARAMETER, Version: 2 }] })));
    await waitFor(() => expect(screen.getByLabelText('Observed listing')).toHaveTextContent(/^2$/));
    expect(success()).toHaveTextContent(message);
    expect(putParameter).toHaveBeenCalledTimes(1);
  });

  it('F8 suppresses double submissions, permits retry on rejection and disables PutParameter on 501', async () => {
    const write = pendingResponse();
    putParameter
      .mockReturnValueOnce(write.response)
      .mockImplementationOnce(() => answer({ __type: 'NotImplemented' }, 501));
    open(PARAMETER_CREATE_PATH);
    fillCreate();
    const form = field('Name').form;
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
    await waitFor(() => expect(alertContent()).toHaveTextContent('Writes are denied.'));
    expect(field('Value')).toHaveValue('local-fixture');
    expect(create()).toBeEnabled();
    fireEvent.click(create());
    await waitFor(() =>
      expect(alertContent()).toHaveTextContent('The emulator answered 501 Not Implemented for PutParameter.'),
    );
    expect(ui.findForm()?.findContent()?.findAlert()?.findHeader()?.getElement()).toHaveTextContent(
      'Not implemented by the emulator',
    );
    expect(create()).toBeDisabled();
    fireEvent.submit(form);
    expect(putParameter).toHaveBeenCalledTimes(2);
  });

  it('F9 has no save control when the exact name is missing at entry', async () => {
    describeParameters.mockImplementation(() => answer({ Parameters: [{ Name: `${NAME}-other` }] }));
    open(parameterEditPath(NAME));
    expect(await screen.findByText(isMissing)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Parameter Store' })).toHaveAttribute('href', PARAMETER_STORE_PATH);
    expect(ui.findForm()).toBeNull();
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
    expect(notifications()).toHaveLength(0);
  });

  it('F11 preserves both policy objects in order and untouched writable metadata on a value-only edit', async () => {
    await openEdit();
    expect(JSON.parse(field('Parameter policies').value)).toEqual([POLICY, OTHER_POLICY]);
    change('New value', 'replacement');
    fireEvent.click(save());
    await visibleHeading('Parameter details');
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
    await waitFor(() => expect(alertContent()).toHaveTextContent('Failed to read the next page.'));
    expect(field('New value')).toHaveValue('replacement');
    expect(field('Description')).toHaveValue('Buffered description');
    expect(putParameter).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(0);
    expect(where()).toBe(parameterEditPath(NAME));

    fireEvent.click(save());
    await visibleHeading('Parameter details');
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

  it.each(DISCONNECTED)('retains the edit after a failed preflight and $kind', async (disconnected) => {
    const recovery = pendingResponse();
    const preflight = pendingResponse();
    describeParameters
      .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }))
      .mockImplementationOnce(() => answer({ Parameters: [], NextToken: 'failed-token' }))
      .mockImplementationOnce(() => answer({ __type: 'ValidationException', message: 'Preflight failed.' }, 400))
      .mockReturnValueOnce(recovery.response)
      .mockImplementationOnce(() => answer({ Parameters: [], NextToken: 'fresh-token' }))
      .mockReturnValueOnce(preflight.response);
    const { connect, where } = await openEdit();
    change('New value', 'replacement');
    change('Description', 'Buffered description');
    change('Allowed pattern', '[a-z0-9]+');
    change('Parameter policies', JSON.stringify([NEXT_POLICY], null, 2));
    const expectDraft = () => {
      expect(field('New value')).toHaveValue('replacement');
      expect(field('Description')).toHaveValue('Buffered description');
      expect(field('Allowed pattern')).toHaveValue('[a-z0-9]+');
      expect(field('Parameter policies')).toHaveValue(JSON.stringify([NEXT_POLICY], null, 2));
    };
    fireEvent.click(save());
    await waitFor(() => expect(alertContent()).toHaveTextContent('Preflight failed.'));

    connect(disconnected);
    expectDraft();
    expect(save()).toBeDisabled();
    fireEvent.submit(required(field('New value').form, 'edit form'));
    expect(describeParameters).toHaveBeenCalledTimes(3);
    expect(putParameter).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(0);
    expect(where()).toBe(parameterEditPath(NAME));

    connect({ ...CONNECTED, checkedAt: 3 });
    await waitFor(() => expect(describeParameters).toHaveBeenCalledTimes(4));
    expectDraft();
    expect(save()).toBeDisabled();
    await act(async () => recovery.resolve(answer({ Parameters: [PARAMETER] })));
    await waitFor(() => expect(save()).toBeEnabled());
    expectDraft();

    fireEvent.click(save());
    await waitFor(() => expect(describeParameters).toHaveBeenCalledTimes(6));
    expect(describeParameters.mock.calls).toEqual([
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS, NextToken: 'failed-token' }],
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS }],
      [{ ParameterFilters: FILTERS, NextToken: 'fresh-token' }],
    ]);
    expect(putParameter).not.toHaveBeenCalled();
    expect(notifications()).toHaveLength(0);
    await act(async () => preflight.resolve(answer({ Parameters: [{ ...PARAMETER, KeyId: 'alias/fresh-key' }] })));
    await visibleHeading('Parameter details');
    expect(putParameter).toHaveBeenCalledExactlyOnceWith({
      Name: NAME,
      Type: PARAMETER.Type,
      Tier: PARAMETER.Tier,
      KeyId: 'alias/fresh-key',
      DataType: PARAMETER.DataType,
      Overwrite: true,
      Value: 'replacement',
      Description: 'Buffered description',
      AllowedPattern: '[a-z0-9]+',
      Policies: JSON.stringify([NEXT_POLICY]),
    });
    expect(requests.slice(0, 7)).toEqual([...Array<string>(6).fill('DescribeParameters'), 'PutParameter']);
  });

  it('reconciles changed metadata on the same target and uses the metadata shown during preflight', async () => {
    const recovered = {
      ...PARAMETER,
      Version: 2,
      KeyId: 'alias/recovered-key',
      Description: 'External description',
      AllowedPattern: '[0-9]+',
      Policies: [{ PolicyText: JSON.stringify(NEXT_POLICY) }],
    };
    const preflight = {
      ...recovered,
      Version: 3,
      KeyId: 'alias/preflight-key',
      AllowedPattern: '[A-Z]+',
      Policies: [{ PolicyText: JSON.stringify(OTHER_POLICY) }],
    };
    const write = pendingResponse();
    describeParameters
      .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }))
      .mockImplementationOnce(() => answer({ Parameters: [recovered] }))
      .mockImplementationOnce(() => answer({ Parameters: [preflight] }));
    putParameter.mockReturnValueOnce(write.response);
    const { connect } = await openEdit();
    change('New value', 'replacement');
    change('Description', 'Buffered description');
    expect(detailValue('KMS key ID')).toHaveTextContent(PARAMETER.KeyId);

    connect(DISCONNECTED[0]);
    expect(save()).toBeDisabled();
    connect({ ...CONNECTED, checkedAt: 3 });
    await waitFor(() => expect(save()).toBeEnabled());
    expect(detailValue('Name')).toHaveTextContent(NAME);
    expect(detailValue('Type')).toHaveTextContent(recovered.Type);
    expect(detailValue('Tier')).toHaveTextContent(recovered.Tier);
    expect(detailValue('Data type')).toHaveTextContent(recovered.DataType);
    expect(detailValue('KMS key ID')).toHaveTextContent(recovered.KeyId);
    expect(field('Allowed pattern')).toHaveValue(recovered.AllowedPattern);
    expect(field('Parameter policies')).toHaveValue(JSON.stringify([NEXT_POLICY], null, 2));
    expect(field('Description')).toHaveValue('Buffered description');
    expect(field('New value')).toHaveValue('replacement');

    fireEvent.click(save());
    await waitFor(() =>
      expect(putParameter).toHaveBeenCalledExactlyOnceWith({
        Name: NAME,
        Type: preflight.Type,
        Tier: preflight.Tier,
        KeyId: preflight.KeyId,
        DataType: preflight.DataType,
        Overwrite: true,
        Value: 'replacement',
        Description: 'Buffered description',
        AllowedPattern: preflight.AllowedPattern,
        Policies: JSON.stringify([OTHER_POLICY]),
      }),
    );
    expect(detailValue('KMS key ID')).toHaveTextContent(preflight.KeyId);
    expect(field('Allowed pattern')).toHaveValue(preflight.AllowedPattern);
    expect(field('Parameter policies')).toHaveValue(JSON.stringify([OTHER_POLICY], null, 2));
    expect(field('Description')).toHaveValue('Buffered description');
    expect(field('New value')).toHaveValue('replacement');
    expect(describeParameters.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ ParameterFilters: FILTERS }]));
    await act(async () => write.resolve(answer({ Version: 4, Tier: 'Advanced' })));
    await visibleHeading('Parameter details');
  });

  it('keeps Retry visible and disabled when an open edit form gets a DescribeParameters 501 on retry', async () => {
    describeParameters
      .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }))
      .mockImplementationOnce(() => answer({ __type: 'ValidationException', message: 'Metadata read failed.' }, 400))
      .mockImplementationOnce(() => answer({ __type: 'NotImplemented' }, 501));
    const { connect, where } = await openEdit();
    change('New value', 'replacement');
    connect(DISCONNECTED[0]);
    connect({ ...CONNECTED, checkedAt: 3 });

    const retry = () => ui.findAllButtons().find((button) => button.getElement().textContent === 'Retry');
    await waitFor(() => expect(retry()?.getElement()).toBeEnabled());
    expect(screen.getByText('Metadata read failed.', { exact: false })).toBeVisible();
    required(retry(), 'Retry button').click();
    await waitFor(() => expect(retry()?.getElement()).toBeDisabled());
    expect(retry()?.getElement()).toBeVisible();
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/The emulator answered 501 Not Implemented for DescribeParameters/)).toBeVisible();
    required(retry(), 'disabled Retry button').click();
    expect(save()).toBeDisabled();
    fireEvent.submit(required(field('New value').form, 'edit form'));

    expect(field('New value')).toHaveValue('replacement');
    expect(field('Description')).toBeEnabled();
    expect(formButton('Cancel')).toBeEnabled();
    fireEvent.click(formButton('Cancel'));
    fireEvent.click(await discardButton('Keep editing'));
    expect(where()).toBe(parameterEditPath(NAME));
    expect(requests).toEqual(['DescribeParameters', 'DescribeParameters', 'DescribeParameters']);
    expect(putParameter).not.toHaveBeenCalled();
  });

  it('starts with a blank value and fresh metadata when the same name is on a different target', async () => {
    const { connect } = await openEdit();
    change('New value', 'local-replacement');
    change('Description', 'Local draft');
    connect(DISCONNECTED[0]);
    describeParameters.mockImplementation(() =>
      answer({ Parameters: [{ ...PARAMETER, Description: 'Other target description' }] }),
    );
    connect({ ...CONNECTED, checkedAt: 3, target: 'other' });
    await waitFor(() => expect(field('New value')).toHaveValue(''));
    expect(field('Description')).toHaveValue('Other target description');
    expect(requests).toEqual(['DescribeParameters', 'DescribeParameters']);
  });

  it('shows the missing state when the exact name is gone on reconnect', async () => {
    const { connect } = await openEdit();
    change('New value', 'replacement');
    connect(DISCONNECTED[1]);
    expect(save()).toBeDisabled();
    describeParameters.mockImplementation(() => answer({ Parameters: [{ Name: `${NAME}-other` }] }));
    connect({ ...CONNECTED, checkedAt: 3 });
    expect(await screen.findByText(isMissing)).toBeVisible();
    expect(ui.findForm()).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Parameter Store' })).toBeVisible();
    expect(putParameter).not.toHaveBeenCalled();
  });
});
