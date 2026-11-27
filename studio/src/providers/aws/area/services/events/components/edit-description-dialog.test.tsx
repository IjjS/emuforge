import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { updateBusDescription } from '../bus-settings-api';
import { EditDescriptionDialog } from './edit-description-dialog';

vi.mock('../bus-settings-api', async (original) => ({
  ...(await original<typeof import('../bus-settings-api')>()),
  updateBusDescription: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const operation = 'UpdateEventBus';
const initial = 'Routes orders';

beforeEach(() => vi.mocked(updateBusDescription).mockReset().mockResolvedValue(undefined));

async function open() {
  const onSaved = vi.fn();
  const onDismiss = vi.fn();
  const onUnavailable = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <EditDescriptionDialog
            endpoint={endpoint}
            name="orders"
            description={initial}
            onSaved={onSaved}
            onDismiss={onDismiss}
            onUnavailable={onUnavailable}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(<Area />);
  return waitFor(() => {
    const modal = createWrapper(container).findModal();
    const field = modal?.findContent().findFormField();
    const textarea = field?.findControl()?.findTextarea();
    const save = modal
      ?.findFooter()
      ?.findAllButtons()
      .find((button) => button.getElement().textContent === 'Save');
    if (!modal || !field || !textarea || !save) throw new Error('Expected the description editor');
    return { modal, field, textarea, save, onSaved, onDismiss, onUnavailable };
  });
}

it('opens with the description as read and rejects 513 characters before writing', async () => {
  const { field, textarea, save } = await open();
  expect(textarea.getTextareaValue()).toBe(initial);
  fireEvent.change(textarea.findNativeTextarea().getElement(), { target: { value: 'x'.repeat(513) } });
  save.click();
  expect(field.findError()?.getElement()).toHaveTextContent('Enter a description of up to 512 characters.');
  expect(updateBusDescription).not.toHaveBeenCalled();
});

it('writes a changed description, including clearing it, then reports success', async () => {
  const { textarea, save, onSaved } = await open();
  fireEvent.change(textarea.findNativeTextarea().getElement(), { target: { value: '' } });
  save.click();
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(updateBusDescription).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', '', expect.any(AbortSignal));
});

it('dismisses an unchanged description without writing', async () => {
  const { save, onDismiss } = await open();
  save.click();
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(updateBusDescription).not.toHaveBeenCalled();
});

const refusals: [RequestFailure, string][] = [
  [{ kind: 'other', operation, code: 'ValidationException', message: 'Description refused' }, 'Description refused'],
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator'],
];

it.each(refusals)('keeps the dialog and draft after a refusal (%s)', async (failure, message) => {
  vi.mocked(updateBusDescription).mockRejectedValueOnce(new RequestError(failure));
  const { modal, textarea, save, onSaved, onDismiss, onUnavailable } = await open();
  fireEvent.change(textarea.findNativeTextarea().getElement(), { target: { value: 'New description' } });
  save.click();
  await waitFor(() => expect(modal.findContent().findAlert()?.getElement()).toHaveTextContent(message));
  expect(modal.findContent().findAlert()?.getElement()).toHaveTextContent(operation);
  expect(textarea.getTextareaValue()).toBe('New description');
  expect(onSaved).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') {
    expect(save.getElement()).toBeDisabled();
    expect(onUnavailable).toHaveBeenCalledOnce();
    save.click();
    expect(updateBusDescription).toHaveBeenCalledOnce();
  }
});
