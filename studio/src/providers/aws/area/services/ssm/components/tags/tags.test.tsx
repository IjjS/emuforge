import type {
  AddTagsToResourceCommandInput,
  DescribeParametersCommandInput,
  ListTagsForResourceCommandInput,
  RemoveTagsFromResourceCommandInput,
} from '@aws-sdk/client-ssm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

async function expand(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

function button(name: string, dialog?: HTMLElement) {
  return (dialog ? within(dialog) : screen).getByRole('button', { name });
}

function change(dialog: HTMLElement, name: string, value: string) {
  fireEvent.change(within(dialog).getByRole('textbox', { name }), { target: { value } });
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
  return screen.findByRole('dialog', { name: title });
}

function expectTag(value: string) {
  const table = within(screen.getByRole('table', { name: 'Parameter tags' }));
  expect(table.getAllByRole('rowheader', { name: KEY })).toHaveLength(1);
  expect(table.getByRole('cell', { name: value })).toBeVisible();
}

describe('Parameter tags', () => {
  it('T1 adds and replaces a key across both refresh response orders', async () => {
    const ops = openDetail();
    await expand('Tags');
    expect(await screen.findByText('No tags')).toBeVisible();
    expect(ops.ListTagsForResource).toHaveBeenCalledWith(TAG_RESOURCE);

    const firstMetadata = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(firstMetadata.response);
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    const add = await tagDialog('Add tag');
    change(add, 'Key', KEY);
    change(add, 'Value', TAG.Value);
    fireEvent.click(button('Add tag', add));
    await screen.findByRole('cell', { name: TAG.Value });
    expect(ops.DescribeParameters).toHaveBeenCalledTimes(2);
    await firstMetadata.finish(metadata('Advanced', 'Metadata after add'));
    await screen.findByText('Metadata after add');
    expect(screen.getByText(saved)).toBeVisible();
    expectTag(TAG.Value);

    const secondTags = deferredResponse();
    ops.ListTagsForResource.mockReturnValueOnce(secondTags.response);
    ops.DescribeParameters.mockImplementationOnce(() => metadata('Advanced', 'Metadata after replace'));
    const edit = await tagDialog(editName, 'Edit tag');
    expect(within(edit).getByRole('textbox', { name: 'Key' })).toHaveValue(KEY);
    change(edit, 'Value', REPLACEMENT.Value);
    fireEvent.click(button('Save tag', edit));
    await screen.findByText('Metadata after replace');
    expectTag(TAG.Value);
    await secondTags.finish(list(REPLACEMENT));
    expect(await screen.findByRole('cell', { name: REPLACEMENT.Value })).toBeVisible();
    expectTag(REPLACEMENT.Value);
    expect(screen.getByText(updated)).toBeVisible();
    expect(ops.AddTagsToResource.mock.calls).toEqual([
      [{ ...TAG_RESOURCE, Tags: [TAG] }],
      [{ ...TAG_RESOURCE, Tags: [REPLACEMENT] }],
    ]);
  });

  it('T2 cancels removal and keeps the confirmed result across metadata refresh', async () => {
    const ops = openDetail();
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    await expand('Tags');
    await screen.findByRole('rowheader', { name: KEY });

    const canceled = await tagDialog(removeName, 'Remove tag');
    fireEvent.click(button('Cancel', canceled));
    expect(ops.RemoveTagsFromResource).not.toHaveBeenCalled();
    expectTag(TAG.Value);

    const delayed = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(delayed.response);
    const confirm = await tagDialog(removeName, 'Remove tag');
    fireEvent.click(button('Remove tag', confirm));
    expect(await screen.findByText('No tags')).toBeVisible();
    expect(ops.RemoveTagsFromResource).toHaveBeenCalledExactlyOnceWith({ ...TAG_RESOURCE, TagKeys: [KEY] });
    await delayed.finish(metadata('Advanced', 'Metadata after remove'));
    await screen.findByText('Metadata after remove');
    expect(screen.getByText('No tags')).toBeVisible();
    expect(screen.queryByRole('rowheader', { name: KEY })).toBeNull();
    expect(screen.getByText(removed)).toBeVisible();
  });

  it('T3 retries denied reads and writes, retains input, and disables an unsupported read', async () => {
    const ops = openDetail();
    ops.ListTagsForResource.mockImplementationOnce(() => denied('Tag read denied'));
    await expand('Tags');
    expect(await screen.findByText(/Tag read denied/)).toBeVisible();
    expect(screen.queryByText('No tags')).toBeNull();
    fireEvent.click(button('Retry'));
    await screen.findByText('No tags');

    ops.AddTagsToResource.mockImplementationOnce(() => denied('Tag write denied'));
    const add = await tagDialog('Add tag');
    change(add, 'Key', KEY);
    change(add, 'Value', TAG.Value);
    fireEvent.click(button('Add tag', add));
    expect(await within(add).findByText(/Tag write denied/)).toBeVisible();
    expect(within(add).getByRole('textbox', { name: 'Key' })).toHaveValue(KEY);
    expect(within(add).getByRole('textbox', { name: 'Value' })).toHaveValue(TAG.Value);
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    fireEvent.click(button('Add tag', add));
    expect(await screen.findByText(saved)).toBeVisible();
    expect(ops.AddTagsToResource).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('rowheader', { name: KEY })).toBeVisible();

    ops.ListTagsForResource.mockImplementationOnce(notImplemented);
    fireEvent.click(button('Refresh tags'));
    expect(await screen.findByText(/501 Not Implemented for ListTagsForResource/)).toBeVisible();
    expect(button('Refresh tags')).toBeDisabled();
    expect(button('Add tag')).toBeEnabled();
    expect(screen.queryByText('No tags')).toBeNull();
  });

  it.each([
    ['AddTagsToResource', editName, 'Edit tag', 'Save tag', removeName],
    ['RemoveTagsFromResource', removeName, 'Remove tag', 'Remove tag', editName],
  ] as const)('T4 isolates an unsupported %s', async (operation, action, title, submit, other) => {
    const ops = openDetail();
    ops.ListTagsForResource.mockImplementationOnce(() => list(TAG));
    ops[operation].mockImplementationOnce(notImplemented);
    await expand('Tags');
    await screen.findByRole('rowheader', { name: KEY });

    const dialog = await tagDialog(action, title);
    fireEvent.click(button(submit, dialog));
    expect(await screen.findByText(`The emulator answered 501 Not Implemented for ${operation}.`)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
    expect(button(action)).toBeDisabled();
    expect(button(other)).toBeEnabled();
    expect(button('Refresh tags')).toBeEnabled();
    expectTag(TAG.Value);
  });
});
