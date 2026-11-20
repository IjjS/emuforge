import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import type { ActionTarget, InstanceAction } from '../status';
import { InstanceActions } from './instance-actions';

// The part alone inside an area's root: it is given an instance, `pending` and `onAction`, and sends nothing.

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

let onAction: ReturnType<typeof vi.fn<(action: InstanceAction, target: ActionTarget) => void>>;

function Harness({ instance, pending }: { instance: ActionTarget | undefined; pending: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <InstanceActions instance={instance} pending={pending} onAction={onAction} />
      </AreaRootContext>
    </div>
  );
}

function renderActions(instance: ActionTarget | undefined, pending = false) {
  onAction = vi.fn();
  const view = render(<Harness instance={instance} pending={pending} />);
  return {
    ...view,
    setPending: (next: boolean) => {
      view.rerender(<Harness instance={instance} pending={next} />);
    },
  };
}

function target(status: string, changes: Partial<ActionTarget> = {}): ActionTarget {
  return { id: 'app-db', status, engine: 'postgres', deletionProtection: false, ...changes };
}

function button(name: string): HTMLElement {
  return screen
    .getAllByRole('button', { name })
    .find((element) => element.closest('[role="dialog"]') === null) as HTMLElement;
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
const AURORA = 'The emulator does not start or stop an Aurora DB instance by itself.';

async function confirmDelete() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
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
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('app-db is deleted from the local emulator');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
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
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    view.setPending(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isDisabled(button('Stop'))).toBe(false);
  });
});
