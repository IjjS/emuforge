import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import type { ActionTarget, InstanceAction } from '../status';
import { InstanceActions } from './instance-actions';

// The part alone inside an area's root: it is given an instance, `pending` and `onAction`, and sends nothing.

const fetchSpy = vi.fn();
const PAGE = createWrapper(document.body);
type DeleteModal = NonNullable<ReturnType<typeof PAGE.findModal>>;

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

let onAction: ReturnType<typeof vi.fn<(action: InstanceAction, target: ActionTarget) => void>>;

function Harness({
  instance,
  pending,
  compact,
}: {
  instance: ActionTarget | undefined;
  pending: boolean;
  compact: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <InstanceActions instance={instance} pending={pending} compact={compact} onAction={onAction} />
      </AreaRootContext>
    </div>
  );
}

function renderActions(instance: ActionTarget | undefined, pending = false, compact = false) {
  onAction = vi.fn();
  const view = render(<Harness instance={instance} pending={pending} compact={compact} />);
  return {
    ...view,
    setPending: (next: boolean) => {
      view.rerender(<Harness instance={instance} pending={next} compact={compact} />);
    },
  };
}

function target(status: string, changes: Partial<ActionTarget> = {}): ActionTarget {
  return { id: 'app-db', status, engine: 'postgres', deletionProtection: false, ...changes };
}

function button(name: string) {
  const modal = PAGE.findModal()?.getElement();
  const action = PAGE.findAllButtons().find(
    (button) =>
      !modal?.contains(button.getElement()) && button.findTextRegion()?.getElement().textContent?.trim() === name,
  );
  if (action === undefined) throw new Error(`Missing lifecycle button: ${name}`);
  return action.getElement();
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** The reason a disabled button gives, as Cloudscape renders it for assistive technology. */
function reasonOf(element: Element): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

/** Each action: `true` when available, else its reason. */
function shown(): Record<string, true | string> {
  return Object.fromEntries(
    ['Start', 'Stop', 'Reboot', 'Delete'].map((name) => {
      const element = button(name);
      return [name, isDisabled(element) ? reasonOf(element) : true];
    }),
  );
}

const STARTED = 'Only a stopped DB instance can be started.';
const STOPPED = 'Only an available DB instance can be stopped.';
const REBOOTED = 'Only an available DB instance can be rebooted.';
const AURORA = 'An Aurora DB instance starts and stops only with its DB cluster.';

function deleteModal() {
  const dialog = PAGE.findModal();
  if (dialog === null) throw new Error('The delete confirmation is not open.');
  expect(dialog.findHeader().getElement()).toHaveTextContent('Delete DB instance?');
  return dialog;
}

function dialogButton(dialog: DeleteModal, label: 'Cancel' | 'Delete') {
  const button = dialog
    .findFooter()
    ?.findAllButtons()
    .find((button) => button.findTextRegion()?.getElement().textContent?.trim() === label);
  if (button === undefined) throw new Error(`Missing confirmation button: ${label}`);
  return button.getElement();
}

async function confirmDelete() {
  const dialog = await waitFor(deleteModal);
  const input = dialog.findContent().findInput();
  if (input === null) throw new Error('Missing confirmation input.');
  input.setInputValue('delete');
  fireEvent.click(dialogButton(dialog, 'Delete'));
}

describe("a DB instance's actions", () => {
  it('no instance given → the four unavailable with "Select one DB instance."', () => {
    renderActions(undefined);
    const select = 'Select one DB instance.';
    expect(shown()).toEqual({ Start: select, Stop: select, Reboot: select, Delete: select });
  });

  it('an instance of each status, of an Aurora engine, with protection on → the available ones and the reasons', () => {
    const cases: [ActionTarget, Record<string, true | string>][] = [
      [target('available'), { Start: STARTED, Stop: true, Reboot: true, Delete: true }],
      [target('stopped'), { Start: true, Stop: STOPPED, Reboot: REBOOTED, Delete: true }],
      [target('creating'), { Start: STARTED, Stop: STOPPED, Reboot: REBOOTED, Delete: true }],
      [
        target('deleting'),
        { Start: STARTED, Stop: STOPPED, Reboot: REBOOTED, Delete: 'This DB instance is already being deleted.' },
      ],
      [
        target('available', { engine: 'aurora-postgresql' }),
        { Start: AURORA, Stop: AURORA, Reboot: true, Delete: true },
      ],
      [
        target('available', { deletionProtection: true }),
        { Start: STARTED, Stop: true, Reboot: true, Delete: 'Deletion protection is on.' },
      ],
    ];
    for (const [instance, expected] of cases) {
      const { unmount } = renderActions(instance);
      expect(shown(), `${instance.status} ${instance.engine ?? ''}`).toEqual(expected);
      unmount();
    }
  });

  it('"Start", "Stop", "Reboot" → onAction once with that action; no request, no result', () => {
    for (const [name, status, action] of [
      ['Start', 'stopped', 'start'],
      ['Stop', 'available', 'stop'],
      ['Reboot', 'available', 'reboot'],
    ] as const) {
      const instance = target(status);
      const { unmount, container } = renderActions(instance);
      fireEvent.click(button(name));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(action, instance);
      expect(container.textContent).not.toMatch(/Starting|Stopping|Rebooting/);
      unmount();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('"Delete" → the dialog naming the instance; confirmed → onAction with the delete; "Cancel" → not called', async () => {
    const instance = target('available');
    renderActions(instance);
    fireEvent.click(button('Delete'));
    const dialog = await waitFor(deleteModal);
    expect(dialog.findContent().getElement()).toHaveTextContent('app-db is deleted from the local emulator');
    fireEvent.click(dialogButton(dialog, 'Cancel'));
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(button('Delete'));
    await confirmDelete();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('delete', instance);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('while pending, the four are unavailable, a second press calls nothing and the dialog does not act; once pending ends the dialog closes', async () => {
    const view = renderActions(target('available'));
    fireEvent.click(button('Delete'));
    await confirmDelete();
    expect(onAction).toHaveBeenCalledTimes(1);
    view.setPending(true);
    for (const name of ['Start', 'Stop', 'Reboot', 'Delete']) {
      expect(isDisabled(button(name)), name).toBe(true);
      fireEvent.click(button(name));
    }
    const dialog = deleteModal();
    fireEvent.click(dialogButton(dialog, 'Delete'));
    fireEvent.click(dialogButton(dialog, 'Cancel'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(PAGE.findModal()?.getElement()).toBeInTheDocument();

    view.setPending(false);
    expect(PAGE.findModal()).toBeNull();
    expect(isDisabled(button('Stop'))).toBe(false);
  });

  it('the compact menu keeps the lifecycle reasons and runs an available action', async () => {
    const instance = target('available', { deletionProtection: true });
    const view = renderActions(instance, false, true);
    const menu = PAGE.findButtonDropdown();
    if (menu === null) throw new Error('Missing lifecycle Actions dropdown.');
    menu.openDropdown();
    const start = menu.findItemById('start', { disabled: true });
    fireEvent.mouseEnter(start?.getElement() as HTMLElement);
    await waitFor(() => expect(menu.findDisabledReason()?.getElement()).toHaveTextContent(STARTED));
    const remove = menu.findItemById('delete', { disabled: true });
    fireEvent.mouseEnter(remove?.getElement() as HTMLElement);
    await waitFor(() =>
      expect(menu.findDisabledReason()?.getElement()).toHaveTextContent('Deletion protection is on.'),
    );
    fireEvent.click(remove?.getElement() as HTMLElement);
    expect(onAction).not.toHaveBeenCalled();
    expect(PAGE.findModal()).toBeNull();
    fireEvent.click(menu.findItemById('stop', { disabled: false })?.getElement() as HTMLElement);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('stop', instance);
    view.setPending(true);
    const trigger = menu.findNativeButton().getElement();
    expect(trigger).toHaveAccessibleName('Actions');
    expect(isDisabled(trigger)).toBe(true);
  });

  it('the compact menu requires the same confirmation before deleting', async () => {
    const instance = target('available');
    renderActions(instance, false, true);
    const menu = PAGE.findButtonDropdown();
    if (menu === null) throw new Error('Missing lifecycle Actions dropdown.');
    menu.openDropdown();
    fireEvent.click(menu.findItemById('delete', { disabled: false })?.getElement() as HTMLElement);
    expect(onAction).not.toHaveBeenCalled();
    await confirmDelete();
    expect(onAction).toHaveBeenCalledExactlyOnceWith('delete', instance);
  });
});
