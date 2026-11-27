import type { Tag } from '@aws-sdk/client-cloudwatch';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { ManageTagsDialog } from './manage-tags-dialog';

const endpoint = 'http://127.0.0.1:8310';
const arn = 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:sample';
const initial = [
  { Key: 'a', Value: '1' },
  { Key: 'b', Value: '2' },
];
const removed = [{ Key: 'b', Value: '2' }];
const page = createWrapper(document.body);

type ReadResult = Awaited<ReturnType<Parameters<typeof ManageTagsDialog>[0]['tags']['refresh']>>;
const refresh = vi.fn<() => Promise<ReadResult>>();

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`${label} missing`);
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function writes(...answers: (number | Response | Promise<Response>)[]) {
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    const status = answers[sent.length] ?? 200;
    sent.push({
      operation: request.headers.get('x-amz-target')?.split('.').at(-1),
      body: (await request.json()) as unknown,
    });
    if (typeof status !== 'number') return status;
    return status === 200
      ? Response.json({})
      : Response.json({ __type: 'ValidationError', message: 'Tag change refused.' }, { status });
  });
  return sent;
}

const untag = { operation: 'UntagResource', body: { ResourceARN: arn, TagKeys: ['a'] } };
const tag = { operation: 'TagResource', body: { ResourceARN: arn, Tags: [{ Key: 'c', Value: '' }] } };

beforeEach(() => {
  refresh.mockReset().mockResolvedValue({ value: removed });
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function open(initialTags: Tag[] = initial) {
  const onSaved = vi.fn();
  const onDismiss = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <ManageTagsDialog
            endpoint={endpoint}
            connection={{ engineOrigin: endpoint, result: undefined }}
            arn={arn}
            initialTags={initialTags}
            tags={{ value: undefined, failure: undefined, loading: false, refresh }}
            unavailable={new Set()}
            onUnavailable={vi.fn()}
            onSaved={() => {
              onSaved();
              view.unmount();
            }}
            onDismiss={() => {
              onDismiss();
              view.unmount();
            }}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  const view = render(
    <MemoryRouter>
      <Area />
    </MemoryRouter>,
  );
  await screen.findByRole('dialog');
  const modal = required(page.findModal(), 'Tag dialog');
  const content = modal.findContent();
  const editor = required(content.findAttributeEditor(), 'Tag editor');
  const buttons = required(modal.findFooter(), 'Dialog footer').findAllButtons();
  const save = required(buttons[1], 'Save button').getElement();
  const cancel = required(buttons[0], 'Cancel button');
  const field = (row: number, column: number) =>
    required(
      editor.findRow(row)?.findField(column)?.findControl()?.findInput(),
      `Tag field ${row.toString()}, ${column.toString()}`,
    )
      .findNativeInput()
      .getElement();
  const alertText = () => content.findAllAlerts().map((alert) => alert.getElement().textContent);
  const add = (key: string) => {
    fireEvent.click(editor.findAddButton().getElement());
    fireEvent.change(field(editor.findRows().length, 1), { target: { value: key } });
  };
  const replaceA = () => {
    fireEvent.click(required(editor.findRow(1)?.findRemoveButton(), 'Remove tag button').getElement());
    add('c');
  };
  return { editor, save, cancel, field, alertText, replaceA, content, onSaved, onDismiss };
}

it('opens with the tags as read, validates rows, and writes nothing for an unchanged save', async () => {
  const sent = writes();
  const unchanged = await open();
  expect(unchanged.editor.findRows()).toHaveLength(2);
  expect(unchanged.field(1, 1)).toHaveValue('a');
  expect(unchanged.field(1, 2)).toHaveValue('1');
  expect(unchanged.field(2, 1)).toHaveValue('b');
  expect(unchanged.field(2, 2)).toHaveValue('2');
  fireEvent.click(unchanged.save);
  expect(unchanged.onDismiss).toHaveBeenCalledOnce();
  expect(unchanged.onSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();

  const edit = await open();
  fireEvent.click(edit.editor.findAddButton().getElement());
  fireEvent.change(edit.field(3, 1), { target: { value: 'AwS:reserved' } });
  fireEvent.click(edit.save);
  expect(edit.editor.findRow(3)?.findField(1)?.findError()?.getElement()).toHaveTextContent(
    'A key must not start with aws:.',
  );
  expect(sent).toEqual([]);
});

it('allows replacing a tag at the 50-tag limit and saves the removal before the addition', async () => {
  const sent = writes();
  const full = [
    { Key: 'a', Value: '1' },
    ...Array.from({ length: 49 }, (_, i) => ({ Key: `k${i.toString()}`, Value: '' })),
  ];
  const edit = await open(full);
  expect(edit.editor.findAddButton().getElement()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(edit.editor.findAddButton().getElement());
  expect(edit.editor.findRows()).toHaveLength(50);
  edit.replaceA();
  expect(edit.editor.findRows()).toHaveLength(50);
  fireEvent.click(edit.save);
  await waitFor(() => expect(edit.onSaved).toHaveBeenCalledOnce());
  expect(sent).toEqual([untag, tag]);
});

it('keeps the draft and reads again when the removal is refused', async () => {
  const sent = writes(400);
  refresh.mockResolvedValue({ value: initial });
  const edit = await open();
  edit.replaceA();
  fireEvent.click(edit.save);
  await waitFor(() => expect(edit.alertText()).toEqual([expect.stringContaining('UntagResource failed')]));
  expect(edit.alertText()[0]).toContain('Tag change refused.');
  expect(edit.field(1, 1)).toHaveValue('b');
  expect(edit.field(2, 1)).toHaveValue('c');
  expect(edit.onSaved).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(sent).toEqual([untag]);
});

it('keeps outside additions and retries only the outstanding addition after a partial save', async () => {
  const reason = 'a CloudWatch resource can be associated with at most 50 tags; got 51';
  const sent = writes(
    200,
    Response.json({ __type: 'InvalidParameterValueException', message: reason }, { status: 400 }),
  );
  refresh.mockResolvedValue({ value: [...removed, { Key: 'outside', Value: 'external value' }] });
  const edit = await open();
  edit.replaceA();
  fireEvent.click(edit.save);
  await waitFor(() => {
    const partial = edit.content.findAlert()?.findContent().getElement();
    expect(partial).toHaveTextContent(
      `The removals were saved. The added and changed tags were not: TagResource: ${reason}`,
    );
    expect(partial).toHaveTextContent('InvalidParameterValueException');
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(edit.field(2, 1)).toHaveValue('c');
  expect(edit.content.getElement()).toHaveTextContent('Added outside this dialog');
  expect(edit.content.getElement()).toHaveTextContent('outside');
  expect(edit.content.getElement()).toHaveTextContent('external value');
  await waitFor(() => expect(edit.save).toBeEnabled());
  fireEvent.click(edit.save);
  await waitFor(() => expect(edit.onSaved).toHaveBeenCalledOnce());
  expect(sent).toEqual([untag, tag, tag]);
});

it.each<{ failure: NonNullable<Parameters<typeof ManageTagsDialog>[0]['tags']['failure']>; detail: string }>([
  {
    failure: { kind: 'not-implemented', operation: 'ListTagsForResource' },
    detail: 'The emulator answered 501 Not Implemented for ListTagsForResource',
  },
  {
    failure: { kind: 'access-denied', operation: 'ListTagsForResource', message: 'The session cannot list tags.' },
    detail: 'ListTagsForResource was refused: The session cannot list tags.',
  },
  {
    failure: { kind: 'other', operation: 'ListTagsForResource', code: 'ReadFailed', message: 'Tags are unavailable.' },
    detail: 'ReadFailed: Tags are unavailable.',
  },
])('blocks saves and shows the $failure.kind reread failure until retry succeeds', async ({ failure, detail }) => {
  const write = deferred<Response>();
  const read = deferred<ReadResult>();
  const retry = deferred<ReadResult>();
  const sent = writes(write.promise);
  refresh.mockReturnValueOnce(read.promise).mockReturnValueOnce(retry.promise);
  const edit = await open();
  edit.replaceA();
  fireEvent.click(edit.save);
  expect(edit.save).toBeDisabled();
  fireEvent.click(edit.save);
  await waitFor(() => expect(sent).toEqual([untag]));
  await act(async () => write.resolve(Response.json({ message: 'Tag change refused.' }, { status: 400 })));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(edit.save).toBeDisabled();
  fireEvent.click(edit.save);
  expect(sent).toEqual([untag]);

  await act(async () => read.resolve({ failure }));
  const readAlert = required(edit.content.findAllAlerts()[1], 'Reread failure alert');
  expect(readAlert.findContent().getElement()).toHaveTextContent('The tags could not be read again.');
  expect(readAlert.findContent().getElement()).toHaveTextContent(detail);
  expect(edit.field(1, 1)).toHaveValue('b');
  expect(edit.field(2, 1)).toHaveValue('c');
  expect(edit.save).toBeDisabled();
  const retryButton = readAlert.findActionSlot()?.findButton();
  expect(retryButton?.getElement()).toBeEnabled();
  fireEvent.click(required(retryButton, 'Retry button').getElement());
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(edit.save).toBeDisabled();
  await act(async () => retry.resolve({ value: initial }));
  expect(edit.save).toBeEnabled();
  expect(edit.alertText()).not.toContainEqual(expect.stringContaining('The tags could not be read again.'));
  expect(edit.field(2, 1)).toHaveValue('c');
  expect(sent).toEqual([untag]);
});

it.each([
  { operation: 'UntagResource', statuses: [501], expected: [untag], latest: initial },
  { operation: 'TagResource', statuses: [200, 501], expected: [untag, tag], latest: removed },
])(
  'retains the draft and disables save after $operation returns 501',
  async ({ operation, statuses, expected, latest }) => {
    const sent = writes(...statuses);
    refresh.mockResolvedValue({ value: latest });
    const edit = await open();
    edit.replaceA();
    fireEvent.click(edit.save);
    await waitFor(() =>
      expect(edit.alertText()).toContainEqual(expect.stringContaining('Not implemented by the emulator')),
    );
    expect(edit.alertText()).toContainEqual(expect.stringContaining(operation));
    expect(edit.field(2, 1)).toHaveValue('c');
    expect(edit.save).toBeDisabled();
    expect(edit.onSaved).not.toHaveBeenCalled();
    expect(sent).toEqual(expected);
    await waitFor(() => expect(edit.cancel.getElement()).toBeEnabled());
    fireEvent.click(edit.cancel.getElement());
    expect(edit.onDismiss).toHaveBeenCalledOnce();
  },
);
