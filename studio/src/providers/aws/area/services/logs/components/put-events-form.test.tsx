import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { putLogEvents } from '../put-events-api';
import { PutEventsForm } from './put-events-form';

vi.mock('../put-events-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../put-events-api')>()),
  putLogEvents: vi.fn(),
}));

const put = vi.mocked(putLogEvents);
const onPut = vi.fn();
const operation = 'PutLogEvents';

beforeEach(() => {
  put.mockReset();
  onPut.mockReset();
});

function Harness() {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  return (
    <AreaRootContext.Provider value={root}>
      <div ref={root}>
        <button onClick={() => setOpen(true)}>Open put form</button>
        {open && (
          <PutEventsForm
            endpoint="http://127.0.0.1:8311"
            group="app"
            stream="web"
            unavailable={unavailable}
            onUnavailable={() => setUnavailable(true)}
            onDismiss={() => setOpen(false)}
            onPut={onPut}
          />
        )}
      </div>
    </AreaRootContext.Provider>
  );
}

async function openForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Open put form' }));
  const dialog = await screen.findByRole('dialog', { name: 'Put log events' });
  const modal = createWrapper().findModal();
  const editor = createWrapper(dialog).findAttributeEditor();
  const [cancel, submit] = modal?.findFooter()?.findAllButtons() ?? [];
  if (!modal || !editor || !submit || !cancel) throw new Error('Put form controls missing');
  return { modal, editor, submit, cancel };
}

it('opens with one empty message and the batch rule, and adds and removes rows', async () => {
  render(<Harness />);
  const { modal, editor } = await openForm();
  expect(modal.findContent().getElement()).toHaveTextContent('UTF-8 bytes plus 26 bytes');
  expect(modal.findContent().getElement()).toHaveTextContent('1,048,576 bytes');
  expect(editor.findRows()).toHaveLength(1);
  expect(editor.findRow(1)?.findField(1)?.findControl()?.findTextarea()?.findNativeTextarea().getElement()).toHaveValue(
    '',
  );
  editor.findAddButton().click();
  expect(await screen.findAllByRole('textbox')).toHaveLength(2);
  editor.findRow(2)?.findRemoveButton()?.click();
  expect(await screen.findAllByRole('textbox')).toHaveLength(1);
});

it('keeps the message and shows the operation and reason on refusal', async () => {
  put.mockRejectedValueOnce(
    new RequestError({ kind: 'other', operation, code: 'InvalidParameterException', message: 'refused batch' }),
  );
  render(<Harness />);
  const { editor, submit } = await openForm();
  editor.findRow(1)?.findField(1)?.findControl()?.findTextarea()?.setTextareaValue('keep me');
  submit.click();
  expect(await screen.findByText('PutLogEvents failed')).toBeVisible();
  expect(screen.getByText('refused batch', { exact: false })).toBeVisible();
  expect(editor.findRow(1)?.findField(1)?.findControl()?.findTextarea()?.findNativeTextarea().getElement()).toHaveValue(
    'keep me',
  );
  expect(onPut).not.toHaveBeenCalled();
});

it('remembers a 501 across dismissing and reopening the form', async () => {
  put.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
  render(<Harness />);
  const { modal, editor, submit, cancel } = await openForm();
  editor.findRow(1)?.findField(1)?.findControl()?.findTextarea()?.setTextareaValue('keep me');
  submit.click();

  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(modal.findContent().getElement()).toHaveTextContent('501 Not Implemented for PutLogEvents');
  expect(editor.findRow(1)?.findField(1)?.findControl()?.findTextarea()?.findNativeTextarea().getElement()).toHaveValue(
    'keep me',
  );
  expect(submit.getElement()).toBeDisabled();
  cancel.click();
  const reopened = await openForm();
  expect(reopened.modal.findContent().getElement()).toHaveTextContent('PutLogEvents');
  expect(reopened.submit.getElement()).toBeDisabled();
  reopened.submit.click();
  expect(put).toHaveBeenCalledTimes(1);
  expect(onPut).not.toHaveBeenCalled();
});
