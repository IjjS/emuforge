import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { DeleteAfterRemovalError, deleteRule, RemoveTargetsError } from '../rule-change-api';
import { DeleteRuleDialog } from './delete-rule-dialog';

vi.mock('../rule-change-api', async (original) => ({
  ...(await original<typeof import('../rule-change-api')>()),
  deleteRule: vi.fn(),
}));

const drop = vi.mocked(deleteRule);
const name = 'Route';
const endpoint = 'http://127.0.0.1:8314';
const refused = (operation: string, message: string) =>
  new RequestError({ kind: 'other', operation, code: 'ValidationException', message });

beforeEach(() => drop.mockReset());

async function open(targetCount = 3) {
  const onDeleted = vi.fn();
  const onUnavailable = vi.fn();
  const onDismiss = vi.fn();
  const onTargetsChanged = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <DeleteRuleDialog
            endpoint={endpoint}
            bus="orders"
            name={name}
            targetCount={targetCount}
            onDeleted={onDeleted}
            onTargetsChanged={onTargetsChanged}
            onUnavailable={onUnavailable}
            onDismiss={onDismiss}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(<Area />);
  const dialog = await waitFor(() => {
    const wrapper = createWrapper(container).findModal();
    if (!wrapper) throw new Error('Expected the delete dialog');
    return wrapper;
  });
  const [cancel, action] = dialog.findFooter().findAllButtons();
  const field = dialog.findContent().findInput()?.findNativeInput().getElement();
  if (!cancel || !action || !field) throw new Error('Expected the delete controls');
  const confirm = () => {
    fireEvent.change(field, { target: { value: name } });
    fireEvent.click(action.getElement());
  };
  return { dialog, action, cancel, field, confirm, onDeleted, onTargetsChanged, onUnavailable, onDismiss };
}

it.each([
  [2, 'The rule and its 2 targets are removed'],
  [1, 'The rule and its target are removed'],
  [0, 'The rule is removed'],
])('describes %i targets and requires the exact name', async (count, text) => {
  const { dialog, field, action } = await open(count);
  expect(dialog.getElement()).toHaveAccessibleName('Delete rule Route?');
  expect(dialog.findContent().getElement()).toHaveTextContent(
    `${text} from your local emulator. This cannot be undone.`,
  );
  expect(field).toHaveAccessibleName("To confirm, type the rule's name.");
  expect(action.getElement()).toBeDisabled();
  fireEvent.change(field, { target: { value: 'route' } });
  expect(action.getElement()).toBeDisabled();
  fireEvent.change(field, { target: { value: name } });
  expect(action.getElement()).toBeEnabled();
  expect(drop).not.toHaveBeenCalled();
});

it('keeps an ordinary RemoveTargets refusal in the dialog without asking for a reread', async () => {
  drop.mockRejectedValueOnce(refused('RemoveTargets', 'Removal refused'));
  const { dialog, confirm, onTargetsChanged, onDeleted } = await open();
  confirm();
  await waitFor(() => expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('RemoveTargets failed'));
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Removal refused');
  expect(onTargetsChanged).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
});

it('shows one line per failed target and keeps the dialog open', async () => {
  drop.mockRejectedValueOnce(
    new RemoveTargetsError([
      { TargetId: 'queue', ErrorCode: 'Denied', ErrorMessage: 'Queue target refused' },
      { TargetId: 'topic', ErrorCode: 'Busy', ErrorMessage: 'Topic target busy' },
    ]),
  );
  const { dialog, confirm, onTargetsChanged, onDeleted } = await open();
  confirm();
  await waitFor(() => expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('RemoveTargets failed'));
  expect(
    dialog
      .findContent()
      .findAll('li')
      .map((entry) => entry.getElement().textContent),
  ).toEqual(['queue Denied: Queue target refused', 'topic Busy: Topic target busy']);
  expect(onTargetsChanged).toHaveBeenCalledOnce();
  expect(onDeleted).not.toHaveBeenCalled();
});

it('explains that the targets went when DeleteRule is refused', async () => {
  drop.mockRejectedValueOnce(new DeleteAfterRemovalError(refused('DeleteRule', 'Delete refused')));
  const { dialog, confirm, onTargetsChanged, onDeleted } = await open();
  confirm();
  await waitFor(() => expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('DeleteRule failed'));
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent(
    "The rule's targets were removed, but the rule was not deleted.",
  );
  expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Delete refused');
  expect(onTargetsChanged).toHaveBeenCalledOnce();
  expect(onDeleted).not.toHaveBeenCalled();
});

it.each(['RemoveTargets', 'DeleteRule', 'ListTargetsByRule'])(
  'reports a 501 from %s in the open dialog',
  async (operation) => {
    drop.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
    const { dialog, action, confirm, onUnavailable, onDeleted } = await open();
    confirm();
    await waitFor(() =>
      expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
    );
    expect(dialog.findContent().findAlert()?.getElement()).toHaveTextContent(operation);
    if (operation === 'ListTargetsByRule') {
      expect(onUnavailable).not.toHaveBeenCalled();
    } else {
      expect(onUnavailable).toHaveBeenCalledWith(operation);
      expect(action.getElement()).toBeDisabled();
    }
    expect(onDeleted).not.toHaveBeenCalled();
  },
);

it('ignores Cancel, Escape and repeated confirmation while deleting', async () => {
  drop.mockReturnValueOnce(new Promise(() => {}));
  const { dialog, action, cancel, confirm, onDismiss } = await open();
  confirm();
  expect(action.getElement()).toBeDisabled();
  expect(cancel.getElement()).toBeDisabled();
  fireEvent.click(action.getElement());
  fireEvent.click(cancel.getElement());
  fireEvent.keyDown(dialog.getElement(), { key: 'Escape' });
  expect(drop).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', name, expect.any(AbortSignal));
  expect(onDismiss).not.toHaveBeenCalled();
});
