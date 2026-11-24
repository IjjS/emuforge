import type {
  AddTagsToResourceCommandInput,
  DeleteParametersCommandInput,
  DescribeParametersCommandInput,
  GetParameterCommandInput,
} from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
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
const deleteParameters = vi.fn<(input: DeleteParametersCommandInput) => Response>();
const addTags = vi.fn<(input: AddTagsToResourceCommandInput) => Response>();
const getParameter = vi.fn<(input: GetParameterCommandInput) => Response>();
const listTags = vi.fn<() => Response>();
const getPolicies = vi.fn<() => Response>();
let nextPort = 8850;
let engineOrigin: string;

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  describeParameters.mockReset().mockImplementation(() => answer({ Parameters: [PARAMETER] }));
  deleteParameter.mockReset().mockImplementation(() => answer({}));
  deleteParameters.mockReset();
  addTags.mockReset().mockImplementation(() => answer({}));
  getParameter.mockReset().mockImplementation(() => answer({ Parameter: { Value: VALUE } }));
  listTags.mockReset().mockImplementation(() => answer({ TagList: [] }));
  getPolicies.mockReset().mockImplementation(() => answer({ Policies: [] }));
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
      case 'DeleteParameters':
        return deleteParameters((await request.json()) as DeleteParametersCommandInput);
      case 'ListTagsForResource':
        return listTags();
      case 'GetResourcePolicies':
        return getPolicies();
      case 'AddTagsToResource':
        return addTags((await request.json()) as AddTagsToResourceCommandInput);
      case 'GetParameter':
        return getParameter((await request.json()) as GetParameterCommandInput);
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

function open(waitForList?: () => Promise<unknown>, initialName = NAME) {
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
    { initialEntries: [parameterPath(initialName)] },
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
function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

const ui = createWrapper();
const detailHeader = () =>
  ui.findAllHeaders().find((header) => header.findHeadingText().getElement().textContent === NAME);
const actions = () => detailHeader()?.findActions()?.getElement();
const deleteButton = () => within(required(actions(), 'detail actions')).getByRole('button', { name: 'Delete' });

const detailSection = () =>
  ui
    .findAllContainers()
    .find(
      (container) =>
        container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === 'Parameter details',
    );
const resourceSection = (name: string) =>
  ui.findAllExpandableSections().find((section) => section.findHeaderText()?.getElement().textContent === name);
const tagsSection = () => resourceSection('Tags');
const details = () =>
  waitFor(() => {
    const heading = detailSection()?.findHeader()?.findHeader()?.findHeadingText().getElement();
    expect(heading).toBeVisible();
    return required(heading, 'Parameter details heading');
  });

function expectDetailReadFailure(message: string) {
  const container = ui
    .findAllContainers()
    .find((item) => within(item.findContent().getElement()).queryByText('The parameter could not be read.'));
  const content = required(container, 'parameter read-failure container').findContent();
  const status = required(content.findStatusIndicator(), 'parameter read status').getElement();
  expect(status).toBeVisible();
  expect(status.textContent).toBe(message);
  const panel = within(content.getElement());
  const recovery = panel.getByRole('link', { name: 'Connection status' });
  expect(recovery).toBeVisible();
  expect(recovery).toHaveAttribute('href', '/');
  const retry = panel.getByRole('button', { name: 'Retry' });
  expect(retry).toBeVisible();
  expect(retry).toBeEnabled();
}

const flash = (type: 'success' | 'info') => ui.findFlashbar()?.findItemsByType(type)[0];

async function deleteDialog(header: string) {
  return waitFor(() => {
    const dialog = required(ui.findModal(), 'delete confirmation dialog');
    expect(dialog.findHeader().getElement().textContent).toBe(header);
    return dialog;
  });
}

async function openDelete() {
  await details();
  fireEvent.click(deleteButton());
  return deleteDialog('Delete parameter');
}

type DeleteDialog = Awaited<ReturnType<typeof openDelete>>;

const dialogButton = (dialog: DeleteDialog, name: string) =>
  within(required(dialog.findFooter(), 'dialog footer').getElement()).getByRole('button', { name });
const confirmationInput = (dialog: DeleteDialog) =>
  required(dialog.findContent().findInput(), 'confirmation input').findNativeInput().getElement();

function confirm(dialog: DeleteDialog, text: string) {
  fireEvent.change(confirmationInput(dialog), { target: { value: text } });
  fireEvent.click(dialogButton(dialog, 'Delete'));
}

async function saveTag(key: string) {
  const add = within(required(tagsSection()?.findContent(), 'Tags panel').getElement()).getByRole('button', {
    name: 'Add tag',
  });
  expect(add).toBeEnabled();
  fireEvent.click(add);
  const dialog = await waitFor(() => {
    const modal = required(ui.findModal(), 'Add tag dialog');
    expect(modal.findHeader().getElement()).toHaveTextContent(/^Add tag$/);
    return modal;
  });
  const inputs = dialog.findContent().findAllInputs();
  fireEvent.change(required(inputs[0], 'tag key').findNativeInput().getElement(), { target: { value: key } });
  fireEvent.change(required(inputs[1], 'tag value').findNativeInput().getElement(), { target: { value: 'test' } });
  fireEvent.click(dialogButton(dialog, 'Add tag'));
  await waitFor(() =>
    expect(flash('success')?.findContent()?.getElement()).toHaveTextContent(`Tag ${key} saved for ${NAME}.`),
  );
}

async function expectDescribeRefusal() {
  return waitFor(() => {
    const panel = ui
      .findAllContainers()
      .map((container) => container.findContent())
      .find((content) => content.getElement().textContent?.includes('501 Not Implemented for DescribeParameters'));
    const content = required(panel, 'metadata refusal panel');
    const status = required(content.findStatusIndicator(), 'metadata refusal status').getElement();
    expect(status).toBeVisible();
    expect(status).toHaveTextContent('Not implemented by the emulator');
    const retry = required(content.findButton(), 'metadata Retry button').getElement();
    expect(retry).toHaveAccessibleName('Retry');
    expect(retry).toBeDisabled();
    return { content, retry };
  });
}

async function refuseMetadataAfterTagWrite() {
  describeParameters
    .mockImplementationOnce(() => answer({ Parameters: [PARAMETER] }))
    .mockImplementation(() => answer({ __type: 'NotImplemented' }, 501));
  const view = open();
  await details();
  expect(describeParameters.mock.calls).toEqual([[{ ParameterFilters: parameterFilters }]]);
  fireEvent.click(required(tagsSection(), 'Tags section').findExpandButton().getElement());
  await saveTag('first');
  const refusal = await expectDescribeRefusal();
  expect(describeParameters.mock.calls).toEqual([
    [{ ParameterFilters: parameterFilters }],
    [{ ParameterFilters: parameterFilters }],
  ]);
  expect(addTags.mock.invocationCallOrder[0]).toBeLessThan(
    required(describeParameters.mock.invocationCallOrder[1], 'refresh call order'),
  );
  return { ...view, ...refusal };
}

const RESOURCE_SECTIONS = [
  {
    name: 'Tags',
    operation: 'ListTagsForResource',
    refresh: 'Refresh tags',
    create: 'Add tag',
    row: 'previous tag value',
    actions: ['Edit tag previous', 'Remove tag previous'],
  },
  {
    name: 'Resource policies',
    operation: 'GetResourcePolicies',
    refresh: 'Refresh resource policies',
    create: 'Create resource policy',
    row: 'previous-policy',
    actions: ['Edit resource policy previous-policy', 'Delete resource policy previous-policy'],
  },
];

function seedResourceReads() {
  listTags.mockImplementation(() => answer({ TagList: [{ Key: 'previous', Value: 'previous tag value' }] }));
  getPolicies.mockImplementation(() =>
    answer({ Policies: [{ PolicyId: 'previous-policy', PolicyHash: 'previous-hash', Policy: '{"Statement":[]}' }] }),
  );
}

async function expandResourceSections() {
  await details();
  for (const { name } of RESOURCE_SECTIONS) {
    fireEvent.click(required(resourceSection(name), name).findExpandButton().getElement());
  }
}

function resourcePanel(name: string) {
  return within(required(resourceSection(name)?.findContent(), `${name} content`).getElement());
}

function expectResourceRows(present: boolean) {
  for (const { name, row, actions } of RESOURCE_SECTIONS) {
    const panel = resourcePanel(name);
    if (present) {
      expect(panel.getByText(row, { exact: true })).toBeVisible();
      for (const action of actions) expect(panel.getByRole('button', { name: action })).toBeEnabled();
    } else {
      expect(panel.queryByText(row, { exact: true })).not.toBeInTheDocument();
      for (const action of actions) expect(panel.queryByRole('button', { name: action })).not.toBeInTheDocument();
    }
  }
}

function expectBlockedResourceReads() {
  for (const { name, operation, refresh, create } of RESOURCE_SECTIONS) {
    const panel = resourcePanel(name);
    expect(panel.getByText(`The emulator answered 501 Not Implemented for ${operation}.`)).toBeVisible();
    expect(panel.getByRole('button', { name: refresh })).toBeDisabled();
    expect(panel.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(panel.getByRole('button', { name: create })).toBeEnabled();
  }
}

async function blockResourceReads() {
  listTags.mockImplementation(() => answer({ __type: 'NotImplemented' }, 501));
  getPolicies.mockImplementation(() => answer({ __type: 'NotImplemented' }, 501));
  for (const { name, refresh } of RESOURCE_SECTIONS) {
    fireEvent.click(resourcePanel(name).getByRole('button', { name: refresh }));
  }
  await waitFor(expectBlockedResourceReads);
  expectResourceRows(true);
}

describe('Parameter Store detail', () => {
  it('D1 reads exact-name metadata and displays the fields without the value', async () => {
    describeParameters.mockImplementation(() =>
      answer({
        Parameters: [{ Name: `${NAME}-other`, Description: 'Prefix match only' }, PARAMETER],
      }),
    );
    open();
    await waitFor(() => {
      const heading = detailHeader()?.findHeadingText().getElement();
      expect(heading).toBeVisible();
      expect(
        within(required(detailHeader(), 'parameter heading').getElement()).getByRole('heading', {
          level: 1,
          name: NAME,
        }),
      ).toBeVisible();
    });
    await details();
    const content = required(detailSection(), 'details section').findContent();
    const fields = required(content.findKeyValuePairs(), 'parameter metadata').findItems();
    expect(describeParameters.mock.calls).toEqual([[{ ParameterFilters: parameterFilters }]]);
    for (const [label, expected] of [
      ['ARN', ARN],
      ['Type', 'SecureString'],
      ['Version', '12'],
      ['Description', 'Application password'],
      ['Last modified by', USER],
      ['Last modified', creationDateText(new Date(MODIFIED * 1000))],
      ['KMS key ID', 'alias/app-key'],
      ['Tier', 'Advanced'],
      ['Data type', 'text'],
      ['Allowed pattern', '[a-z]+'],
    ] as const) {
      const field = required(
        fields.find((item) => item.findLabel()?.getElement().textContent === label),
        label,
      );
      const value = required(field.findValue(), `${label} value`);
      const displayed = (value.findCopyToClipboard()?.findDisplayedText() ?? value).getElement();
      expect(displayed).toBeVisible();
      expect(displayed.textContent).toBe(expected);
    }
    const metadata = within(content.getElement());
    expect(metadata.getByText('Expiration')).toBeVisible();
    expect(metadata.getByText('Pending')).toBeVisible();
    expect(
      metadata.getByText(JSON.stringify(JSON.parse(POLICY), null, 2), { normalizer: (text) => text }),
    ).toBeVisible();
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(screen.queryByText('Prefix match only')).toBeNull();
  });

  it('preserves the original parameter policy text when it is not valid JSON', async () => {
    const policyText = '  {"Type":\n  Expiration}  ';
    describeParameters.mockImplementation(() =>
      answer({ Parameters: [{ ...PARAMETER, Policies: [{ ...PARAMETER.Policies[0], PolicyText: policyText }] }] }),
    );
    open();
    await details();
    expect(
      within(required(detailSection(), 'details section').findContent().getElement()).getByText(policyText, {
        normalizer: (text) => text,
      }),
    ).toBeVisible();
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
    expectDetailReadFailure(`The EmuForge engine at ${engineOrigin} is not answering`);

    connect({ ...connected, kind: 'emulator-unreachable', checkedAt: 3, reason: 'not_started', message: '' });
    expectDetailReadFailure(`Not started on port ${emulator.port}`);
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
    expect(dialog.findContent().getElement()).toHaveTextContent(
      /removes this parameter and its versions from your local emulator/,
    );
    expect(dialog.findContent().findFormField()?.findLabel()?.getElement()).toHaveTextContent(
      `To confirm, type “${NAME}” in the field.`,
    );
    confirm(dialog, NAME.slice(1));
    expect(deleteParameter).not.toHaveBeenCalled();
    fireEvent.click(dialogButton(dialog, 'Cancel'));
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
    await waitFor(() => {
      const header = ui.findTable()?.findHeaderSlot()?.findHeader();
      expect(header?.findHeadingText().getElement()).toHaveTextContent('Parameter Store');
      expect(
        within(required(header, 'Parameter Store header').getElement()).getByRole('heading', {
          name: 'Parameter Store',
          level: 1,
        }),
      ).toBeVisible();
    });
    expect(flash('success')?.findContent()?.getElement()).toHaveTextContent(`Parameter ${NAME} deleted.`);
    expect(deleteParameter.mock.calls).toEqual([[{ Name: NAME }]]);
  });

  it('evicts the deleted parameter’s tag and policy rows when the same name is recreated under blocked reads', async () => {
    seedResourceReads();
    deleteParameter.mockImplementation(() => {
      describeParameters.mockImplementation(() => answer({ Parameters: [] }));
      return answer({});
    });
    const { router } = open();
    await expandResourceSections();
    await waitFor(() => expectResourceRows(true));
    await blockResourceReads();

    confirm(await openDelete(), NAME);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(PARAMETER_STORE_PATH);
      expect(flash('success')?.findContent()?.getElement()).toHaveTextContent(`Parameter ${NAME} deleted.`);
    });

    describeParameters.mockImplementation(() =>
      answer({ Parameters: [{ ...PARAMETER, Version: 1, Description: 'Recreated parameter' }] }),
    );
    await act(() => router.navigate(parameterPath(NAME)));
    expect(await screen.findByText('Recreated parameter')).toBeVisible();
    await expandResourceSections();
    expectBlockedResourceReads();
    expectResourceRows(false);
    expect(listTags).toHaveBeenCalledTimes(2);
    expect(getPolicies).toHaveBeenCalledTimes(2);
  });

  it('evicts only confirmed bulk deletions on the affected target under blocked reads', async () => {
    const deletedName = 'database';
    const rejected = 'rejected';
    const unconfirmed = 'unconfirmed';
    const sibling = 'database-sibling';
    const names = [deletedName, rejected, unconfirmed, sibling];
    const metadata = names.map((Name) => ({
      ...PARAMETER,
      Name,
      ARN: `arn:aws:ssm:us-east-1:000000000000:parameter/${Name}`,
    }));
    let parameters = metadata;
    describeParameters.mockImplementation(() => answer({ Parameters: parameters }));
    deleteParameters.mockImplementation(() => {
      parameters = metadata.filter(({ Name }) => Name !== deletedName);
      return answer({ DeletedParameters: [deletedName], InvalidParameters: [rejected] });
    });
    const { router, connect } = open(undefined, deletedName);
    const visitDetails = async (name: string) => {
      await act(() => router.navigate(parameterPath(name)));
      await expandResourceSections();
    };

    const otherTarget = { ...connected, checkedAt: 2, target: 'other' };
    await details();
    connect(otherTarget);
    seedResourceReads();
    await visitDetails(deletedName);
    await waitFor(() => expectResourceRows(true));
    await blockResourceReads();
    await act(() => router.navigate(PARAMETER_STORE_PATH));

    connect({ ...connected, checkedAt: 3 });
    seedResourceReads();
    for (const name of names) {
      await visitDetails(name);
      await waitFor(() => expectResourceRows(true));
    }
    await blockResourceReads();
    await act(() => router.navigate(PARAMETER_STORE_PATH));

    const selected = [deletedName, rejected, unconfirmed];
    for (const name of selected) {
      fireEvent.click(await screen.findByRole('checkbox', { name: `Select ${name}` }));
    }
    const listActions = ui.findTable()?.findHeaderSlot()?.findHeader()?.findActions();
    fireEvent.click(within(required(listActions, 'list actions').getElement()).getByRole('button', { name: 'Delete' }));
    confirm(await deleteDialog('Delete parameters'), 'delete');
    await waitFor(() => {
      expect(flash('success')?.findContent()?.getElement()).toHaveTextContent(deletedName);
      expect(screen.queryByRole('link', { name: deletedName })).not.toBeInTheDocument();
    });
    expect(deleteParameters.mock.calls).toEqual([[{ Names: selected }]]);

    parameters = metadata.map((parameter) =>
      parameter.Name === deletedName ? { ...parameter, Version: 1, Description: 'Recreated parameter' } : parameter,
    );
    const tagReads = listTags.mock.calls.length;
    const policyReads = getPolicies.mock.calls.length;
    await visitDetails(deletedName);
    expect(screen.getByText('Recreated parameter')).toBeVisible();
    expectBlockedResourceReads();
    expectResourceRows(false);
    for (const name of [rejected, unconfirmed, sibling]) {
      await visitDetails(name);
      expectBlockedResourceReads();
      expectResourceRows(true);
    }
    await act(() => router.navigate(PARAMETER_STORE_PATH));
    connect({ ...otherTarget, checkedAt: 4 });
    await visitDetails(deletedName);
    expectBlockedResourceReads();
    expectResourceRows(true);
    expect(listTags).toHaveBeenCalledTimes(tagReads);
    expect(getPolicies).toHaveBeenCalledTimes(policyReads);
  });

  it('D4 keeps access denial retryable and makes only DeleteParameter unavailable on 501', async () => {
    deleteParameter
      .mockReturnValueOnce(answer({ __type: 'AccessDeniedException', message: 'Denied for this parameter.' }, 403))
      .mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
    const { router } = open();
    const dialog = await openDelete();
    confirm(dialog, NAME);
    expect(await within(dialog.findContent().getElement()).findByText(/Denied for this parameter/)).toBeVisible();
    expect(confirmationInput(dialog)).toHaveValue(NAME);
    const retry = dialogButton(dialog, 'Delete');
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    const message = 'The emulator answered 501 Not Implemented for DeleteParameter.';
    await waitFor(() => {
      expect(flash('info')?.findContent()?.getElement()).toHaveTextContent(message);
      expect(flash('info')?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(deleteButton()).toBeDisabled();
    });
    expect(deleteButton()).toHaveAccessibleDescription(expect.stringContaining(message));
    fireEvent.click(required(flash('info')?.findDismissButton(), 'dismiss button').getElement());
    await waitFor(() => expect(flash('info')).toBeUndefined());
    expect(actions()).toHaveTextContent(message);
    expect(await details()).toBeVisible();
    expect(
      within(required(detailSection(), 'details section').findContent().getElement()).getByRole('button', {
        name: 'Copy ARN',
      }),
    ).toBeEnabled();

    const otherName = '/app/other';
    describeParameters.mockImplementation(({ ParameterFilters }) =>
      answer({ Parameters: ParameterFilters ? [PARAMETER] : [PARAMETER, { ...PARAMETER, Name: otherName }] }),
    );
    await act(() => router.navigate(PARAMETER_STORE_PATH));
    const table = await waitFor(() => {
      const list = ui.findTable();
      expect(list?.findRows()).toHaveLength(2);
      return required(list, 'parameter table');
    });
    const listActions = table.findHeaderSlot()?.findHeader()?.findActions()?.getElement();
    const listDelete = within(required(listActions, 'list actions')).getByRole('button', { name: 'Delete' });
    for (const [index, name] of [NAME, otherName].entries()) {
      fireEvent.click(
        within(required(table.findRows()[index], `row for ${name}`).getElement()).getByRole('checkbox', {
          name: `Select ${name}`,
        }),
      );
      if (index === 0) {
        expect(listDelete).toBeDisabled();
        expect(listActions).toHaveTextContent(message);
      }
    }
    expect(listDelete).toBeEnabled();
    expect(listActions).not.toHaveTextContent(message);

    await act(() => router.navigate(parameterPath(NAME)));
    await details();
    expect(deleteButton()).toBeDisabled();
    expect(actions()).toHaveTextContent(message);
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
    const loading = ui
      .findAllStatusIndicators()
      .find((status) => status.getElement().textContent === 'Loading parameter…');
    expect(loading?.getElement()).toBeVisible();
    finishPage(answer({ Parameters: [PARAMETER] }));
    expect(await details()).toBeVisible();
  });

  it('retains confirmed metadata and independent actions when a successful tag write is followed by a 501', async () => {
    const { router, content, retry } = await refuseMetadataAfterTagWrite();
    expect(content.getElement()).toHaveTextContent('Showing the last confirmed parameter details.');
    const metadata = required(detailSection(), 'details section').findContent();
    const version = metadata
      .findKeyValuePairs()
      ?.findItems()
      .find((item) => item.findLabel()?.getElement().textContent === 'Version');
    expect(required(version?.findValue(), 'version').getElement()).toHaveTextContent(/^12$/);
    expect(within(required(actions(), 'detail actions')).getByRole('link', { name: 'Edit parameter' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(retry);

    const showValue = within(metadata.getElement()).getByRole('button', { name: 'Show value' });
    expect(showValue).toBeEnabled();
    fireEvent.click(showValue);
    expect(await within(metadata.getElement()).findByText(VALUE)).toBeVisible();
    expect(getParameter.mock.calls).toEqual([[{ Name: NAME, WithDecryption: true }]]);

    await saveTag('second');
    expect(addTags.mock.calls).toEqual(
      ['first', 'second'].map((Key) => [
        { ResourceId: NAME, ResourceType: 'Parameter', Tags: [{ Key, Value: 'test' }] },
      ]),
    );
    expect(deleteButton()).toBeEnabled();
    confirm(await openDelete(), NAME);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(PARAMETER_STORE_PATH);
      expect(flash('success')?.findContent()?.getElement()).toHaveTextContent(`Parameter ${NAME} deleted.`);
    });
    expect(deleteParameter.mock.calls).toEqual([[{ Name: NAME }]]);
    expect(describeParameters).toHaveBeenCalledTimes(2);
  });

  it('clears retained metadata when the engine disconnects', async () => {
    const { connect } = await refuseMetadataAfterTagWrite();
    connect({ kind: 'engine-unreachable', checkedAt: 2, lastEmulatorPort: emulator.port });
    expectDetailReadFailure(`The EmuForge engine at ${engineOrigin} is not answering`);
    expect(detailSection()).toBeUndefined();
    expect(tagsSection()).toBeUndefined();
    expect(deleteButton()).toBeDisabled();
    expect(describeParameters).toHaveBeenCalledTimes(2);
  });

  it('does not reuse refused metadata when opening another name on the same target', async () => {
    const { router } = await refuseMetadataAfterTagWrite();
    await act(() => router.navigate(parameterPath('/app/other')));
    await expectDescribeRefusal();
    expect(detailSection()).toBeUndefined();
    expect(tagsSection()).toBeUndefined();
    expect(describeParameters).toHaveBeenCalledTimes(2);
  });

  it('reads the same name on the new target and does not reuse the old target’s metadata', async () => {
    const { connect } = await refuseMetadataAfterTagWrite();
    connect({ ...connected, checkedAt: 2, target: 'other' });
    await waitFor(() => expect(describeParameters).toHaveBeenCalledTimes(3));
    await expectDescribeRefusal();
    expect(describeParameters).toHaveBeenLastCalledWith({ ParameterFilters: parameterFilters });
    expect(detailSection()).toBeUndefined();
    expect(tagsSection()).toBeUndefined();
    expect(deleteButton()).toBeDisabled();
  });
});
