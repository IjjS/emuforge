import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { putRetentionPolicy } from '../group-create-api';
import { deleteRetentionPolicy } from '../group-settings-api';
import { EditRetentionDialog } from './edit-retention-dialog';

vi.mock('../group-create-api', async (original) => ({
  ...(await original<typeof import('../group-create-api')>()),
  putRetentionPolicy: vi.fn(),
}));
vi.mock('../group-settings-api', async (original) => ({
  ...(await original<typeof import('../group-settings-api')>()),
  deleteRetentionPolicy: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8310';
const name = '/app#Group';
const put = vi.mocked(putRetentionPolicy);
const remove = vi.mocked(deleteRetentionPolicy);
const saved = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  put.mockResolvedValue({ $metadata: {} });
  remove.mockResolvedValue({ $metadata: {} });
});

function Harness({ retention }: { retention: number | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <AreaRootContext.Provider value={root}>
      <div ref={root}>
        <button onClick={() => setOpen(true)}>Edit retention</button>
        {open && (
          <EditRetentionDialog
            endpoint={endpoint}
            name={name}
            retention={retention}
            unavailable={unavailable}
            onUnavailable={(operation) => setUnavailable((current) => new Set([...current, operation]))}
            onSaved={(choice) => {
              saved(choice);
              setOpen(false);
            }}
            onDismiss={() => setOpen(false)}
          />
        )}
      </div>
    </AreaRootContext.Provider>
  );
}

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit retention' }));
  const element = await screen.findByRole('dialog', { name: 'Edit retention' });
  const select = createWrapper(element).findSelect();
  if (select === null) throw new Error('Retention select was not found.');
  return { dialog: within(element), select, save: within(element).getByRole('button', { name: 'Save' }) };
}

it('starts on the current retention and describes every option', async () => {
  render(<Harness retention={7} />);
  const { select } = await open();
  expect(select.findTrigger().getElement()).toHaveTextContent('7 days');
  act(() => select.openDropdown());
  const options = select.findDropdown().findOptions();
  expect(options).toHaveLength(23);
  expect(options[0]?.findLabel().getElement()).toHaveTextContent('Never expire');
  for (const option of options) expect(option.findDescription()?.getElement()).not.toBeEmptyDOMElement();
});

it.each([
  ['30', 30],
  ['', undefined],
] as const)('saves retention choice %s with its operation', async (value, days) => {
  render(<Harness retention={7} />);
  const { select, save } = await open();
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue(value));
  await act(async () => fireEvent.click(save));
  if (days === undefined) {
    expect(remove).toHaveBeenCalledWith(endpoint, name, expect.any(AbortSignal));
    expect(put).not.toHaveBeenCalled();
  } else {
    expect(put).toHaveBeenCalledWith(endpoint, name, days, expect.any(AbortSignal));
    expect(remove).not.toHaveBeenCalled();
  }
  expect(saved).toHaveBeenCalledWith(days);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('shows the operation and refusal while keeping the chosen value', async () => {
  put.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: 'PutRetentionPolicy',
      code: 'InvalidParameterException',
      message: 'Value refused.',
    }),
  );
  render(<Harness retention={7} />);
  const { dialog, select, save } = await open();
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue('30'));
  fireEvent.click(save);
  expect(await dialog.findByText('PutRetentionPolicy failed')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('Value refused.');
  expect(select.findTrigger().getElement()).toHaveTextContent('30 days');
  expect(saved).not.toHaveBeenCalled();
});

it.each([
  ['PutRetentionPolicy', 7, '', remove],
  ['DeleteRetentionPolicy', undefined, '7', put],
] as const)(
  'remembers a 501 for %s across openings and permits the other operation',
  async (operation, retention, next, other) => {
    const attempted = retention === undefined ? remove : put;
    attempted.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
    render(<Harness retention={retention} />);
    const initial = await open();
    fireEvent.click(initial.save);
    expect(await initial.dialog.findByText('Not implemented by the emulator')).toBeVisible();
    expect(initial.dialog.getByRole('alert')).toHaveTextContent(operation);
    expect(initial.save).toBeDisabled();
    fireEvent.click(initial.dialog.getByRole('button', { name: 'Cancel' }));
    const reopened = await open();
    expect(reopened.save).toBeDisabled();
    expect(reopened.dialog.getByRole('alert')).toHaveTextContent(operation);
    act(() => reopened.select.openDropdown());
    act(() => reopened.select.selectOptionByValue(next));
    await act(async () => fireEvent.click(reopened.save));
    expect(attempted).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  },
);
