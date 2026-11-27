import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { listRuleTargets } from '../rule-api';
import { putRuleTargets, PutTargetsError } from '../target-api';
import { AddTargetDialog } from './add-target-dialog';

const topic = { label: 'Orders', value: 'arn:topic', description: 'arn:topic' };

vi.mock('../rule-api', async (original) => ({
  ...(await original<typeof import('../rule-api')>()),
  listRuleTargets: vi.fn(),
}));
vi.mock('../target-api', async (original) => ({
  ...(await original<typeof import('../target-api')>()),
  putRuleTargets: vi.fn(),
}));
vi.mock('../target-sources', async (original) => ({
  ...(await original<typeof import('../target-sources')>()),
  targetChoiceSource: (_kind: string, endpoint: string) => ({
    key: ['topics'],
    endpoint,
    operation: 'ListTopics',
    read: () => Promise.resolve({ items: [topic] }),
    optionOf: (resource: typeof topic) => resource,
  }),
}));

const read = vi.mocked(listRuleTargets);
const write = vi.mocked(putRuleTargets);
const connection = { engineOrigin: 'http://127.0.0.1:8327', result: undefined };

beforeEach(() => {
  read.mockReset().mockResolvedValue([]);
  write.mockReset().mockResolvedValue(undefined);
});

async function openAndSubmit() {
  const onAdded = vi.fn();
  const onUnavailable = vi.fn();
  function Root() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext value={root}>
        <div ref={root}>
          <AddTargetDialog
            connection={connection}
            bus="orders"
            name="route"
            onAdded={onAdded}
            onUnavailable={onUnavailable}
            onDismiss={vi.fn()}
          />
        </div>
      </AreaRootContext>
    );
  }
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <Root />
    </QueryClientProvider>,
  );
  const dialog = await waitFor(() => {
    const modal = createWrapper(container).findModal();
    if (!modal) throw new Error('Expected the Add target dialog');
    return modal;
  });
  const input = dialog.findContent().findInput()?.findNativeInput().getElement();
  if (!input) throw new Error('Expected the target ID');
  fireEvent.change(input, { target: { value: 'delivery' } });
  act(() => dialog.findContent().findSelect()?.openDropdown());
  act(() => dialog.findContent().findSelect()?.selectOptionByValue('sns'));
  const select = dialog.findContent().findAllSelects()[1];
  act(() => select?.openDropdown());
  await waitFor(() => expect(select?.findDropdown().findOptionByValue(topic.value)).toBeTruthy());
  act(() => select?.selectOptionByValue(topic.value));
  const confirm = dialog.findFooter()?.findAllButtons()[1];
  if (!confirm) throw new Error('Expected the confirm button');
  act(() => confirm.click());
  return { dialog, input, confirm, onAdded, onUnavailable };
}

it('rereads the rule targets before saving the single target and reports its ID', async () => {
  const { onAdded } = await openAndSubmit();
  await waitFor(() => expect(onAdded).toHaveBeenCalledWith('delivery'));
  expect(read).toHaveBeenCalledWith(connection.engineOrigin, 'orders', 'route', expect.any(AbortSignal));
  expect(write).toHaveBeenCalledWith(
    connection.engineOrigin,
    'orders',
    'route',
    [{ Id: 'delivery', Arn: 'arn:topic' }],
    expect.any(AbortSignal),
  );
  expect(read).toHaveBeenCalledBefore(write);
});

it('refuses an ID already in use, at the ID field', async () => {
  read.mockResolvedValueOnce([{ Id: 'delivery', Arn: 'arn:existing' }]);
  const { dialog, input } = await openAndSubmit();
  await waitFor(() =>
    expect(dialog.findContent().findFormField()?.findError()?.getElement()).toHaveTextContent(
      'The rule already holds a target with this ID.',
    ),
  );
  expect(input).toHaveValue('delivery');
  expect(write).not.toHaveBeenCalled();
});

it('refuses to write to a rule already at the target limit', async () => {
  read.mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => ({ Id: String(i), Arn: `arn:target:${String(i)}` })));
  const { dialog } = await openAndSubmit();
  await waitFor(() =>
    expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('A rule holds at most 5 targets.'),
  );
  expect(write).not.toHaveBeenCalled();
});

it.each([
  new RequestError({ kind: 'other', operation: 'PutTargets', code: 'Denied', message: 'Write refused' }),
  new PutTargetsError([{ TargetId: 'delivery', ErrorCode: 'Denied', ErrorMessage: 'Write refused' }]),
])('keeps the entered fields and names the operation and reason for a refusal', async (error) => {
  write.mockRejectedValueOnce(error);
  const { dialog, input, onAdded } = await openAndSubmit();
  await waitFor(() => expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Write refused'));
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('PutTargets');
  expect(input).toHaveValue('delivery');
  expect(dialog.findContent().findAllSelects()[1]?.findTrigger().getElement()).toHaveTextContent('Orders');
  expect(onAdded).not.toHaveBeenCalled();
});

it('makes the save unavailable after PutTargets answers 501', async () => {
  write.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'PutTargets' }));
  const { dialog, input, confirm, onUnavailable } = await openAndSubmit();
  await waitFor(() =>
    expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('PutTargets');
  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(input).toHaveValue('delivery');
  expect(confirm.getElement()).toBeDisabled();
  act(() => confirm.click());
  expect(write).toHaveBeenCalledOnce();
});

it('keeps the dialog open and skips the write when the save read answers 501', async () => {
  read.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'ListTargetsByRule' }));
  const { dialog, input, onUnavailable } = await openAndSubmit();
  await waitFor(() =>
    expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('ListTargetsByRule');
  expect(input).toHaveValue('delivery');
  expect(write).not.toHaveBeenCalled();
  expect(onUnavailable).not.toHaveBeenCalled();
});
