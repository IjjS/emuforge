import type {
  AddTagsToResourceCommandInput,
  DescribeParametersCommandInput,
  ListTagsForResourceCommandInput,
  RemoveTagsFromResourceCommandInput,
} from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import AwsArea from '../../../../index';
import { parameterPath } from '../../paths';

afterEach(() => vi.unstubAllGlobals());

const NAME = '/app/database/host';
const ARN = 'arn:aws:ssm:us-east-1:000000000000:parameter/app/database/host';
const TAG_RESOURCE = { ResourceId: NAME, ResourceType: 'Parameter' };

const connected = {
  kind: 'connected',
  checkedAt: 1,
  target: 'local',
  emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
} as const;
let nextPort = 8780;

function answer(body: object = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function denied(message: string) {
  return answer({ __type: 'AccessDeniedException', message }, 403);
}

function notImplemented() {
  return answer({ __type: 'NotImplemented' }, 501);
}

function metadata(Tier = 'Advanced', Description = 'Initial metadata') {
  return answer({ Parameters: [{ Name: NAME, ARN, Version: 1, Type: 'String', Tier, Description }] });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  return { response, finish: async (reply: Response) => act(async () => resolve(reply)) };
}

function openDetail() {
  const engineOrigin = `http://127.0.0.1:${nextPort++}`;
  const operations = {
    DescribeParameters: vi.fn<(input: DescribeParametersCommandInput) => Response | Promise<Response>>(() =>
      metadata(),
    ),
    ListTagsForResource: vi.fn<(input: ListTagsForResourceCommandInput) => Response | Promise<Response>>(() =>
      answer(),
    ),
    AddTagsToResource: vi.fn<(input: AddTagsToResourceCommandInput) => Response>(() => answer()),
    RemoveTagsFromResource: vi.fn<(input: RemoveTagsFromResourceCommandInput) => Response>(() => answer()),
  };

  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    if (!Object.hasOwn(operations, operation)) throw new Error(`Unexpected AWS request: ${operation}`);
    const handler = operations[operation as keyof typeof operations] as (data: unknown) => Response | Promise<Response>;
    return handler(await request.json());
  });

  const router = createMemoryRouter(
    [
      {
        path: '/aws/*',
        element: (
          <AwsArea
            connection={{ engineOrigin, result: connected }}
            headerSelector="#top-bar"
            routeChanges={0}
            onPageTitle={() => undefined}
            onContentTarget={() => undefined}
          />
        ),
      },
    ],
    { initialEntries: [parameterPath(NAME)] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return operations;
}

const page = createWrapper(document.body);
const section = () =>
  page.findAllExpandableSections().find((candidate) => candidate.findHeaderText()?.getElement().textContent === 'Tags');
const sectionContent = () => section()?.findContent();
const metadataContent = () =>
  page
    .findAllContainers()
    .find(
      (container) =>
        container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === 'Parameter details',
    )
    ?.findContent();
const description = () =>
  metadataContent()
    ?.findKeyValuePairs()
    ?.findItems()
    .find((item) => item.findLabel()?.getElement().textContent === 'Description')
    ?.findValue()
    ?.getElement();

const expectDescription = (text: string) =>
  waitFor(() => {
    const value = description();
    expect(value).toBeVisible();
    expect(value?.textContent).toBe(text);
  });

async function expand() {
  const toggle = await waitFor(() => {
    const button = section()?.findExpandButton().getElement();
    assert(button);
    expect(button).toHaveAccessibleName('Tags');
    return button;
  });
  fireEvent.click(toggle);
}

type Dialog = NonNullable<ReturnType<typeof page.findModal>>;

function button(name: string, dialog?: Dialog) {
  if (!dialog) return screen.getByRole('button', { name });
  const footer = dialog.findFooter();
  assert(footer);
  return within(footer.getElement()).getByRole('button', { name });
}

function flash(message: string) {
  return page
    .findFlashbar()
    ?.findItemsByType('success')
    .map((item) => item.findContent()?.getElement())
    .find((content) => content?.textContent === message);
}

function expectUnsupported(operation: string) {
  return waitFor(() => {
    const message = `The emulator answered 501 Not Implemented for ${operation}.`;
    const alert = sectionContent()
      ?.findAllAlerts()
      .find((item) => item.findContent().getElement().textContent === message);
    expect(alert?.findContent().getElement()).toBeVisible();
    expect(alert?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
  });
}

const KEY = 'stage';
const TAG = { Key: KEY, Value: 'one' };
const REPLACEMENT = { Key: KEY, Value: 'two' };
const list = (...tags: (typeof TAG)[]) => answer({ TagList: tags });
const editName = 'Edit tag stage';
const removeName = 'Remove tag stage';
const saved = `Tag ${KEY} saved for ${NAME}.`;
const updated = `Tag ${KEY} updated for ${NAME}.`;
const removed = `Tag ${KEY} removed from ${NAME}.`;

async function tagDialog(name: string, title = name) {
  fireEvent.click(button(name));
  return waitFor(() => {
    const dialog = page.findModal();
    assert(dialog);
    expect(dialog.findHeader().getElement().textContent).toBe(title);
    expect(dialog.getElement()).toBeVisible();
    expect(dialog.getElement()).toHaveAccessibleName(title);
    return dialog;
  });
}

function tagTable() {
  return sectionContent()?.findTable();
}

function tagEmpty() {
  const empty = tagTable()?.findEmptySlot();
  assert(empty);
  return within(empty.getElement());
}

function expectTag(value: string) {
  const table = tagTable();
  assert(table);
  expect(table.findRows()).toHaveLength(1);
  const keyCell = table.findBodyCell(1, 1)?.getElement();
  const valueCell = table.findBodyCell(1, 2)?.getElement();
  expect(keyCell).toBeVisible();
  expect(keyCell?.textContent).toBe(KEY);
  expect(valueCell).toBeVisible();
  expect(valueCell?.textContent).toBe(value);
}

function tagInput(dialog: Dialog, name: string) {
  const field = dialog
    .findContent()
    .findAllFormFields()
    .find((candidate) => candidate.findLabel()?.getElement().textContent === name);
  assert(field);
  const input = createWrapper(field.getElement()).findInput()?.findNativeInput().getElement();
  assert(input);
  expect(input).toHaveAccessibleName(name);
  return input;
}

function change(dialog: Dialog, name: string, value: string) {
  fireEvent.change(tagInput(dialog, name), { target: { value } });
}

describe('Parameter tags', () => {
  it('T1 adds and replaces a key across both refresh response orders', async () => {
    const ops = openDetail();
    await expand();
    await waitFor(() => expect(tagEmpty().getByText('No tags')).toBeVisible());
    expect(ops.ListTagsForResource).toHaveBeenCalledWith(TAG_RESOURCE);

    const firstMetadata = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(firstMetadata.response);
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    const add = await tagDialog('Add tag');
    change(add, 'Key', KEY);
    change(add, 'Value', TAG.Value);
    fireEvent.click(button('Add tag', add));
    await waitFor(() => expectTag(TAG.Value));
    expect(ops.DescribeParameters).toHaveBeenCalledTimes(2);
    await firstMetadata.finish(metadata('Advanced', 'Metadata after add'));
    await expectDescription('Metadata after add');
    expect(flash(saved)).toBeVisible();
    expectTag(TAG.Value);

    const secondTags = deferredResponse();
    ops.ListTagsForResource.mockReturnValueOnce(secondTags.response);
    ops.DescribeParameters.mockImplementationOnce(() => metadata('Advanced', 'Metadata after replace'));
    const edit = await tagDialog(editName, 'Edit tag');
    expect(tagInput(edit, 'Key')).toHaveValue(KEY);
    change(edit, 'Value', REPLACEMENT.Value);
    fireEvent.click(button('Save tag', edit));
    await expectDescription('Metadata after replace');
    expectTag(TAG.Value);
    await secondTags.finish(list(REPLACEMENT));
    await waitFor(() => expectTag(REPLACEMENT.Value));
    expect(flash(updated)).toBeVisible();
    expect(ops.AddTagsToResource.mock.calls).toEqual([
      [{ ...TAG_RESOURCE, Tags: [TAG] }],
      [{ ...TAG_RESOURCE, Tags: [REPLACEMENT] }],
    ]);
  });

  it('T2 cancels removal and keeps the confirmed result across metadata refresh', async () => {
    const ops = openDetail();
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    await expand();
    await waitFor(() => expectTag(TAG.Value));

    const canceled = await tagDialog(removeName, 'Remove tag');
    fireEvent.click(button('Cancel', canceled));
    expect(ops.RemoveTagsFromResource).not.toHaveBeenCalled();
    expectTag(TAG.Value);

    const delayed = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(delayed.response);
    const confirm = await tagDialog(removeName, 'Remove tag');
    fireEvent.click(button('Remove tag', confirm));
    await waitFor(() => expect(tagEmpty().getByText('No tags')).toBeVisible());
    expect(ops.RemoveTagsFromResource).toHaveBeenCalledExactlyOnceWith({ ...TAG_RESOURCE, TagKeys: [KEY] });
    await delayed.finish(metadata('Advanced', 'Metadata after remove'));
    await expectDescription('Metadata after remove');
    expect(tagEmpty().getByText('No tags')).toBeVisible();
    expect(tagTable()?.findRows()).toHaveLength(0);
    expect(flash(removed)).toBeVisible();
  });

  it('T3 retries denied reads and writes, retains input, and disables an unsupported read', async () => {
    const ops = openDetail();
    ops.ListTagsForResource.mockImplementationOnce(() => denied('Tag read denied'));
    await expand();
    await waitFor(() => expect(tagEmpty().getByText(/Tag read denied/)).toBeVisible());
    expect(tagEmpty().queryByText('No tags')).toBeNull();
    fireEvent.click(button('Retry'));
    await waitFor(() => expect(tagEmpty().getByText('No tags')).toBeVisible());

    ops.AddTagsToResource.mockImplementationOnce(() => denied('Tag write denied'));
    const add = await tagDialog('Add tag');
    change(add, 'Key', KEY);
    change(add, 'Value', TAG.Value);
    fireEvent.click(button('Add tag', add));
    await waitFor(() => {
      const reason = add.findContent().findAlert()?.findContent().getElement();
      expect(reason).toBeVisible();
      expect(reason).toHaveTextContent(/Tag write denied/);
    });
    expect(tagInput(add, 'Key')).toHaveValue(KEY);
    expect(tagInput(add, 'Value')).toHaveValue(TAG.Value);
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    fireEvent.click(button('Add tag', add));
    await waitFor(() => expect(flash(saved)).toBeVisible());
    expect(ops.AddTagsToResource).toHaveBeenCalledTimes(2);
    await waitFor(() => expectTag(TAG.Value));

    ops.ListTagsForResource.mockImplementationOnce(notImplemented);
    fireEvent.click(button('Refresh tags'));
    await expectUnsupported('ListTagsForResource');
    expect(button('Refresh tags')).toBeDisabled();
    expect(button('Add tag')).toBeEnabled();
    expect(tagTable()?.findEmptySlot()?.getElement().textContent ?? '').not.toContain('No tags');
  });

  it.each([
    ['AddTagsToResource', editName, 'Edit tag', 'Save tag', removeName],
    ['RemoveTagsFromResource', removeName, 'Remove tag', 'Remove tag', editName],
  ] as const)('T4 isolates an unsupported %s', async (operation, action, title, submit, other) => {
    const ops = openDetail();
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    ops[operation].mockImplementationOnce(notImplemented);
    await expand();
    await waitFor(() => expectTag(TAG.Value));

    const dialog = await tagDialog(action, title);
    fireEvent.click(button(submit, dialog));
    await expectUnsupported(operation);
    await waitFor(() => expect(page.findModal()).toBeNull());
    expect(button(action)).toBeDisabled();
    expect(button(other)).toBeEnabled();
    expect(button('Refresh tags')).toBeEnabled();
    expectTag(TAG.Value);
  });
});
