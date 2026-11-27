import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { RemoveTargetsError, removeRuleTarget } from '../rule-change-api';
import { RemoveTargetDialog } from './remove-target-dialog';

vi.mock('../rule-change-api', async (original) => ({
  ...(await original<typeof import('../rule-change-api')>()),
  removeRuleTarget: vi.fn(),
}));

const remove = vi.mocked(removeRuleTarget);
const operation = 'RemoveTargets';
const endpoint = 'http://127.0.0.1:8314';

beforeEach(() => remove.mockReset());

async function open() {
  const onRemoved = vi.fn();
  const onUnavailable = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <RemoveTargetDialog
            endpoint={endpoint}
            bus="orders"
            name="route"
            id="queue"
            onRemoved={onRemoved}
            onUnavailable={onUnavailable}
            onDismiss={vi.fn()}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(<Area />);
  const dialog = await waitFor(() => {
    const wrapper = createWrapper(container).findModal();
    if (!wrapper) throw new Error('Expected the remove dialog');
    return wrapper;
  });
  const [, action] = dialog.findFooter().findAllButtons();
  if (!action) throw new Error('Expected the Remove button');
  return { dialog, action, onRemoved, onUnavailable };
}

it('names the target and explains the removal without asking for typed confirmation', async () => {
  remove.mockResolvedValueOnce(undefined);
  const { dialog, action, onRemoved } = await open();
  expect(dialog.getElement()).toHaveAccessibleName('Remove target queue?');
  expect(dialog.findContent().getElement()).toHaveTextContent(
    'The rule stops delivering to it. The resource it points at is not changed.',
  );
  expect(dialog.findContent().findInput()).toBeNull();
  expect(action.getElement()).toBeEnabled();
  fireEvent.click(action.getElement());
  await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
  expect(remove).toHaveBeenCalledWith(endpoint, 'orders', 'route', 'queue', expect.any(AbortSignal));
});

it.each([
  new RequestError({ operation, kind: 'other', code: 'Denied', message: 'Removal refused' }),
  new RemoveTargetsError([{ TargetId: 'queue', ErrorCode: 'Denied', ErrorMessage: 'Removal refused' }]),
])('keeps the operation and the reason in the open dialog after a refusal', async (failure) => {
  remove.mockRejectedValueOnce(failure);
  const { dialog, action, onRemoved } = await open();
  fireEvent.click(action.getElement());
  await waitFor(() => expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent(operation));
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Denied: Removal refused');
  expect(onRemoved).not.toHaveBeenCalled();
});

it('keeps the action unavailable after RemoveTargets returns 501', async () => {
  remove.mockRejectedValueOnce(new RequestError({ operation, kind: 'not-implemented' }));
  const { dialog, action, onUnavailable, onRemoved } = await open();
  fireEvent.click(action.getElement());
  await waitFor(() =>
    expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent(operation);
  expect(action.getElement()).toBeDisabled();
  fireEvent.click(action.getElement());
  expect(remove).toHaveBeenCalledOnce();
  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(onRemoved).not.toHaveBeenCalled();
});
