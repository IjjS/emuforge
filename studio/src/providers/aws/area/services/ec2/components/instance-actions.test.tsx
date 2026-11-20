import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import * as api from '../api';
import { InstanceActions, type ActionTarget } from './instance-actions';

// The actions inside an area's root and flash, with `actOnInstance` answered by the case.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, actOnInstance: vi.fn() };
});

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: 'http://127.0.0.1:8309' };

let shown: FlashResult[];

function Harness({ instance, protectionOn }: { instance: ActionTarget | undefined; protectionOn?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <PageFlashContext value={{ show: (result) => shown.push(result), handOver: () => undefined }}>
          <InstanceActions
            instance={instance}
            connection={CONNECTION}
            {...(protectionOn === undefined ? {} : { protectionOn })}
          />
        </PageFlashContext>
      </AreaRootContext>
    </div>
  );
}

function renderActions(instance: ActionTarget | undefined, protectionOn?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness instance={instance} {...(protectionOn === undefined ? {} : { protectionOn })} />
    </QueryClientProvider>,
  );
}

function text(node: ReactNode): string {
  const { container, unmount } = render(<>{node}</>);
  const result = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
  unmount();
  return result;
}

/** The "Instance state" menu's button. */
function menu(): HTMLElement {
  return screen.getByRole('button', { name: /^Instance state/ });
}

/** The menu's items, in order, opened from its button; closed again when `close`. */
function openItems(): HTMLElement[] {
  if (menu().getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(menu());
  }
  return screen.getAllByRole('menuitem');
}

function item(name: string): HTMLElement {
  const found = openItems().find((element) => element.textContent?.trim() === name);
  expect(found, name).toBeDefined();
  return found as HTMLElement;
}

/** Chooses `name` from the menu. */
function press(name: string) {
  fireEvent.click(item(name));
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

const ACTIONS = ['Start', 'Stop', 'Reboot', 'Terminate'];

function availabilities() {
  const result = Object.fromEntries(
    ACTIONS.map((name) => {
      const element = item(name);
      return [name, isDisabled(element) ? reasonOf(element) : 'available'];
    }),
  );
  fireEvent.click(menu());
  return result;
}

interface Held {
  args: unknown[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

function held(): Held[] {
  const calls: Held[] = [];
  vi.mocked(api.actOnInstance).mockImplementation(
    (...args: unknown[]) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ args, resolve: () => resolve(), reject });
      }),
  );
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  shown = [];
});

describe("an instance's actions", () => {
  it('no instance given → the four unavailable with "Select one instance."', () => {
    renderActions(undefined);
    expect(availabilities()).toEqual({
      Start: 'Select one instance.',
      Stop: 'Select one instance.',
      Reboot: 'Select one instance.',
      Terminate: 'Select one instance.',
    });
  });

  it('one "Instance state" menu: Start, Stop, Reboot, then Terminate last in a group of its own', () => {
    renderActions({ id: 'i-1', state: 'running' });
    const items = openItems();
    expect(items.map((element) => element.textContent?.trim())).toEqual(ACTIONS);
    const groups = items.map((element) => element.closest('[role="group"]'));
    expect(groups[0]).toBe(groups[1]);
    expect(groups[1]).toBe(groups[2]);
    expect(groups[3]).not.toBe(groups[2]);
  });

  it('an instance of each state → the available actions and the reasons of the others', () => {
    const expected: Record<string, Record<string, string>> = {
      running: {
        Start: 'Only a stopped instance can be started.',
        Stop: 'available',
        Reboot: 'available',
        Terminate: 'available',
      },
      stopped: {
        Start: 'available',
        Stop: 'Only a running instance can be stopped.',
        Reboot: 'Only a running instance can be rebooted.',
        Terminate: 'available',
      },
      pending: {
        Start: 'Only a stopped instance can be started.',
        Stop: 'Only a running instance can be stopped.',
        Reboot: 'Only a running instance can be rebooted.',
        Terminate: 'available',
      },
      stopping: {
        Start: 'Only a stopped instance can be started.',
        Stop: 'Only a running instance can be stopped.',
        Reboot: 'Only a running instance can be rebooted.',
        Terminate: 'available',
      },
      'shutting-down': {
        Start: 'Only a stopped instance can be started.',
        Stop: 'Only a running instance can be stopped.',
        Reboot: 'Only a running instance can be rebooted.',
        Terminate: 'This instance is already shutting down.',
      },
      terminated: {
        Start: 'Only a stopped instance can be started.',
        Stop: 'Only a running instance can be stopped.',
        Reboot: 'Only a running instance can be rebooted.',
        Terminate: 'This instance is already terminated.',
      },
    };
    for (const [state, actions] of Object.entries(expected)) {
      const { unmount } = renderActions({ id: 'i-1', state });
      expect(availabilities(), state).toEqual(actions);
      unmount();
    }
  });

  for (const [name, state, action, result] of [
    ['Start', 'stopped', 'start', 'Starting i-1'],
    ['Stop', 'running', 'stop', 'Stopping i-1'],
    ['Reboot', 'running', 'reboot', 'Rebooting i-1'],
  ] as const) {
    it(`"${name}" → sent at once and "${result}" shown as a success`, async () => {
      const calls = held();
      renderActions({ id: 'i-1', state });
      press(name);
      await waitFor(() => {
        expect(calls).toHaveLength(1);
      });
      expect(calls[0]?.args.slice(1, 3)).toEqual([action, 'i-1']);
      expect(shown).toEqual([]);
      act(() => {
        calls[0]?.resolve();
      });
      await waitFor(() => {
        expect(shown).toHaveLength(1);
      });
      expect(shown[0]).toEqual([{ type: 'success', content: result }]);
    });
  }

  it('termination protection on → "Terminate" unavailable with "Termination protection is on."; off or not given → by the state alone', () => {
    for (const state of ['running', 'stopped']) {
      const on = renderActions({ id: 'i-1', state }, true);
      expect(availabilities().Terminate).toBe('Termination protection is on.');
      on.unmount();
      for (const protectionOn of [false, undefined]) {
        const off = renderActions({ id: 'i-1', state }, protectionOn);
        expect(availabilities().Terminate).toBe('available');
        off.unmount();
      }
    }
    const gone = renderActions({ id: 'i-1', state: 'terminated' }, false);
    const byState = availabilities().Terminate;
    gone.unmount();
    renderActions({ id: 'i-1', state: 'terminated' }, true);
    expect(availabilities().Terminate).toBe(byState);
  });

  it('"Terminate" → the dialog; confirmed → sent and "Terminating i-1" shown; the dialog closed', async () => {
    const calls = held();
    renderActions({ id: 'i-1', state: 'running', name: 'web' });
    press('Terminate');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('web is terminated in the local emulator.');
    expect(calls).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'terminate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminate' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.args.slice(1, 3)).toEqual(['terminate', 'i-1']);
    act(() => {
      calls[0]?.resolve();
    });
    await waitFor(() => {
      expect(shown).toEqual([[{ type: 'success', content: 'Terminating i-1' }]]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('while a request is in flight the four are unavailable and a second press sends nothing', async () => {
    const calls = held();
    renderActions({ id: 'i-1', state: 'running' });
    press('Stop');
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(isDisabled(menu())).toBe(true);
    fireEvent.click(menu());
    expect(screen.queryAllByRole('menuitem')).toEqual([]);
    expect(calls).toHaveLength(1);
    act(() => {
      calls[0]?.resolve();
    });
    await waitFor(() => {
      expect(isDisabled(menu())).toBe(false);
    });
    expect(isDisabled(item('Reboot'))).toBe(false);
  });

  it('a refusal → an error with the code and message; a 501 → "not implemented by the emulator"; the dialog closed', async () => {
    const calls = held();
    renderActions({ id: 'i-1', state: 'running' });
    press('Terminate');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'terminate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminate' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const refusal: RequestFailure = {
      kind: 'other',
      operation: 'TerminateInstances',
      code: 'OperationNotPermitted',
      message: "The instance 'i-1' may not be terminated.",
    };
    act(() => {
      calls[0]?.reject(new RequestError(refusal));
    });
    await waitFor(() => {
      expect(shown).toHaveLength(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const [item] = shown[0] ?? [];
    expect(item?.type).toBe('error');
    expect(text(item?.content)).toContain('OperationNotPermitted');
    expect(text(item?.content)).toContain("The instance 'i-1' may not be terminated.");

    press('Reboot');
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    act(() => {
      calls[1]?.reject(new RequestError({ kind: 'not-implemented', operation: 'RebootInstances' }));
    });
    await waitFor(() => {
      expect(shown).toHaveLength(2);
    });
    const [notImplemented] = shown[1] ?? [];
    expect(text(notImplemented?.header)).toBe('Not implemented by the emulator');
    expect(text(notImplemented?.content)).toContain('RebootInstances');
  });
});
