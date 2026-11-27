import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { listResourceTags } from '../bus-api';
import { PartialTagSaveError, saveBusTags, type TagWriteOperation } from '../bus-settings-api';
import { useResourceTags } from '../queries';
import { ManageTagsDialog } from './manage-tags-dialog';

vi.mock('../bus-api', async (original) => ({
  ...(await original<typeof import('../bus-api')>()),
  listResourceTags: vi.fn(),
}));

vi.mock('../bus-settings-api', async (original) => ({
  ...(await original<typeof import('../bus-settings-api')>()),
  saveBusTags: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const arn = 'arn:orders';
const initial = { old: 'gone', team: 'core' };
const listTags = vi.mocked(listResourceTags);
const write = vi.mocked(saveBusTags);

beforeEach(() => {
  vi.resetAllMocks();
  listTags.mockResolvedValue(initial);
  write.mockResolvedValue(undefined);
});

async function open(initialTags: Record<string, string> = initial) {
  const onSaved = vi.fn();
  const onDismiss = vi.fn();
  const onUnavailable = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const tags = useResourceTags(endpoint, arn);
    const [unavailable, setUnavailable] = useState(new Set<TagWriteOperation>());
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <ManageTagsDialog
            connection={{ engineOrigin: endpoint, result: undefined }}
            endpoint={endpoint}
            arn={arn}
            initialTags={initialTags}
            tags={tags}
            unavailable={unavailable}
            onUnavailable={(operation) => {
              onUnavailable(operation);
              setUnavailable((current) => new Set([...current, operation]));
            }}
            onSaved={onSaved}
            onDismiss={onDismiss}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return waitFor(() => {
    const modal = createWrapper(container).findModal();
    const editor = modal?.findContent().findAttributeEditor();
    const save = modal
      ?.findFooter()
      ?.findAllButtons()
      .find((button) => button.getElement().textContent === 'Save');
    if (!modal || !editor || !save) throw new Error('Expected the tags editor');
    expect(save.getElement()).toBeEnabled();
    return { modal, editor, save, onSaved, onDismiss, onUnavailable };
  });
}

type Editor = Awaited<ReturnType<typeof open>>['editor'];

function field(editor: Editor, row: number, column: number) {
  const control = editor.findRow(row)?.findField(column);
  if (!control) throw new Error('Expected a tag field');
  return control;
}

function change(editor: Editor, row: number, column: number, value: string) {
  const input = field(editor, row, column).findControl()?.findInput()?.findNativeInput().getElement();
  if (!input) throw new Error('Expected a tag input');
  fireEvent.change(input, { target: { value } });
}

function editTags(editor: Editor) {
  editor.findRow(1)?.findRemoveButton()?.click();
  change(editor, 1, 2, 'local');
  editor.findAddButton().click();
  change(editor, 2, 1, 'project');
  change(editor, 2, 2, 'orders');
}

function refusal(operation: TagWriteOperation) {
  return new RequestError({ kind: 'other', operation, code: 'ValidationException', message: 'Tags refused' });
}

it('loads the existing tags and rejects an invalid row without writing', async () => {
  const { editor, save } = await open();
  expect(editor.findRows()).toHaveLength(2);
  expect(
    [1, 2].map((row) => [1, 2].map((column) => field(editor, row, column).findControl()?.findInput()?.getInputValue())),
  ).toEqual(Object.entries(initial));
  change(editor, 1, 1, 'aws:reserved');
  save.click();
  expect(field(editor, 1, 1).findError()?.getElement()).toHaveTextContent('A tag key cannot start with aws:.');
  expect(write).not.toHaveBeenCalled();
});

it('shows the limit and rejects 51 existing rows without writing', async () => {
  const many = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`tag-${String(index)}`, 'value']));
  listTags.mockResolvedValue(many);
  const { modal, editor, save } = await open(many);
  expect(editor.findAddButton().getElement()).toHaveAttribute('aria-disabled', 'true');
  save.click();
  expect(modal.findContent().findFormField()?.findError()?.getElement()).toHaveTextContent(
    'You can add up to 50 tags.',
  );
  expect(write).not.toHaveBeenCalled();
});

it('saves the removal, change and addition and reports success', async () => {
  const { editor, save, onSaved } = await open();
  editTags(editor);
  save.click();
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(write).toHaveBeenCalledExactlyOnceWith(
    endpoint,
    arn,
    { remove: ['old'], put: { team: 'local', project: 'orders' } },
    expect.any(AbortSignal),
  );
});

it('dismisses unchanged tags without writing', async () => {
  const { save, onDismiss } = await open();
  save.click();
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
});

it('keeps the operation and reason in the dialog when removals are refused', async () => {
  write.mockRejectedValueOnce(refusal('UntagResource'));
  const { modal, editor, save, onSaved, onDismiss } = await open();
  editTags(editor);
  save.click();
  await waitFor(() => expect(modal.findContent().findAlert()?.getElement()).toHaveTextContent('UntagResource failed'));
  expect(modal.findContent().findAlert()?.getElement()).toHaveTextContent('Tags refused');
  expect(onSaved).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
});

it('shows the partial save and sends only the changes still missing from the re-read tags', async () => {
  write.mockRejectedValueOnce(new PartialTagSaveError(refusal('TagResource')));
  listTags.mockResolvedValueOnce(initial).mockResolvedValueOnce({ team: 'core' });
  const { modal, editor, save, onSaved } = await open();
  editTags(editor);
  save.click();
  await waitFor(() => {
    const alerts = modal.findContent().findAllAlerts();
    expect(alerts[0]?.getElement()).toHaveTextContent(
      'The removed tags were saved. The added and changed tags were not.',
    );
    expect(alerts[1]?.getElement()).toHaveTextContent('TagResource failed');
    expect(alerts[1]?.getElement()).toHaveTextContent('Tags refused');
    expect(listTags).toHaveBeenCalledTimes(2);
    expect(save.getElement()).toBeEnabled();
  });
  expect(onSaved).not.toHaveBeenCalled();
  save.click();
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(write).toHaveBeenLastCalledWith(
    endpoint,
    arn,
    { remove: [], put: { team: 'local', project: 'orders' } },
    expect.any(AbortSignal),
  );
});

it('blocks another save after the re-read fails until Retry reads the tags', async () => {
  write.mockRejectedValueOnce(new PartialTagSaveError(refusal('TagResource')));
  listTags
    .mockResolvedValueOnce(initial)
    .mockRejectedValueOnce(
      new RequestError({
        kind: 'other',
        operation: 'ListTagsForResource',
        code: 'ReadError',
        message: 'Read failed',
      }),
    )
    .mockResolvedValueOnce({ team: 'core' });
  const { modal, editor, save } = await open();
  editTags(editor);
  save.click();
  await waitFor(() =>
    expect(modal.findContent().findStatusIndicator()?.getElement()).toHaveTextContent(
      'The event bus tags could not be read',
    ),
  );
  expect(modal.findContent().getElement()).toHaveTextContent('The tags could not be read again.');
  expect(save.getElement()).toBeDisabled();
  save.click();
  expect(write).toHaveBeenCalledOnce();
  const retry = modal
    .findContent()
    .findAllButtons()
    .find((button) => button.getElement().textContent === 'Retry');
  expect(retry?.getElement()).toBeEnabled();
  retry?.click();
  await waitFor(() => expect(save.getElement()).toBeEnabled());
  expect(listTags).toHaveBeenCalledTimes(3);
});

it.each(['UntagResource', 'TagResource'] as const)('shows %s as unavailable after 501', async (operation) => {
  write.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
  const { modal, editor, save, onUnavailable, onSaved } = await open();
  if (operation === 'UntagResource') editor.findRow(1)?.findRemoveButton()?.click();
  else change(editor, 2, 2, 'local');
  save.click();
  await waitFor(() =>
    expect(modal.findContent().findAlert()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(modal.findContent().findAlert()?.getElement()).toHaveTextContent(operation);
  expect(save.getElement()).toBeDisabled();
  expect(onUnavailable).toHaveBeenCalledExactlyOnceWith(operation);
  expect(onSaved).not.toHaveBeenCalled();
  save.click();
  expect(write).toHaveBeenCalledOnce();
});
