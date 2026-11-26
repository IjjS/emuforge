import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { CREATE_LOG_STREAM, createLogStream } from '../stream-change-api';
import { CreateLogStreamDialog } from './create-log-stream-dialog';

vi.mock('../stream-change-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-change-api')>()),
  createLogStream: vi.fn(),
}));

const create = vi.mocked(createLogStream);
const rule = 'Enter 1 to 512 characters, without ":", "*", or line breaks.';

beforeEach(() => create.mockReset());

async function renderDialog() {
  const created = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [unavailable, setUnavailable] = useState(false);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <CreateLogStreamDialog
            endpoint="http://127.0.0.1:8310"
            group="/app#Group"
            unavailable={unavailable}
            onUnavailable={() => setUnavailable(true)}
            onCreated={created}
            onDismiss={vi.fn()}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  render(<Area />);
  const dialog = within(await screen.findByRole('dialog', { name: 'Create log stream' }));
  return {
    dialog,
    name: dialog.getByRole('textbox', { name: 'Log stream name' }),
    action: dialog.getByRole('button', { name: 'Create log stream' }),
    created,
  };
}

it.each(['a:b', 'a*b', '', 'a'.repeat(513)])('shows the rule and rejects an invalid name %#', async (value) => {
  const { dialog, name, action } = await renderDialog();
  expect(dialog.getByText(rule)).toBeVisible();
  fireEvent.change(name, { target: { value } });
  fireEvent.click(action);
  expect(name).toHaveAccessibleDescription(
    value === '' ? expect.stringContaining('Enter a log stream name.') : expect.stringContaining(rule),
  );
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(create).not.toHaveBeenCalled();
});

it.each(['\r', '\n', '\r\n'])('rejects a name containing a line break %# at the name field', async (lineBreak) => {
  const { name, action, created } = await renderDialog();
  fireEvent.change(name, { target: { value: 'first' + lineBreak + 'second' } });
  fireEvent.click(action);
  expect(name).toHaveAccessibleDescription(
    expect.stringContaining('Remove line breaks. The browser can change them in the name field.'),
  );
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(create).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});

it('keeps the name and shows the operation and reason in the dialog when refused', async () => {
  create.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: CREATE_LOG_STREAM,
      code: 'ResourceAlreadyExistsException',
      message: 'The stream exists.',
    }),
  );
  const { dialog, name, action, created } = await renderDialog();
  fireEvent.change(name, { target: { value: 'a b/[$LATEST]' } });
  fireEvent.click(action);
  expect(await dialog.findByText('CreateLogStream failed')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('ResourceAlreadyExistsException: The stream exists.');
  expect(name).toHaveValue('a b/[$LATEST]');
  expect(action).toBeEnabled();
  expect(created).not.toHaveBeenCalled();
});

it('keeps the name and disables the action when CreateLogStream answers 501', async () => {
  create.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: CREATE_LOG_STREAM }));
  const { dialog, name, action, created } = await renderDialog();
  fireEvent.change(name, { target: { value: 'stream' } });
  fireEvent.click(action);
  expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('501 Not Implemented for CreateLogStream');
  expect(name).toHaveValue('stream');
  expect(action).toBeDisabled();
  fireEvent.keyDown(name, { key: 'Enter' });
  expect(create).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
});
