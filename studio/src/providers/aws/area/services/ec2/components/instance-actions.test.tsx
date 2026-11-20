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

function Harness({ instance }: { instance: ActionTarget | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <PageFlashContext value={{ show: (result) => shown.push(result), handOver: () => undefined }}>
          <InstanceActions instance={instance} connection={CONNECTION} />
        </PageFlashContext>
      </AreaRootContext>
    </div>
  );
}

function renderActions(instance: ActionTarget | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness instance={instance} />
    </QueryClientProvider>,
  );
}

function text(node: ReactNode): string {
  const { container, unmount } = render(<>{node}</>);
  const result = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
  unmount();
  return result;
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name });
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
  return Object.fromEntries(
    ACTIONS.map((name) => {
      const element = button(name);
      return [name, isDisabled(element) ? reasonOf(element) : 'available'];
    }),
  );
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
      fireEvent.click(button(name));
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

  it('"Terminate" → the dialog; confirmed → sent and "Terminating i-1" shown; the dialog closed', async () => {
    const calls = held();
    renderActions({ id: 'i-1', state: 'running', name: 'web' });
    fireEvent.click(button('Terminate'));
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
    fireEvent.click(button('Stop'));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    for (const name of ACTIONS) {
      expect(isDisabled(button(name)), name).toBe(true);
    }
    fireEvent.click(button('Reboot'));
    fireEvent.click(button('Stop'));
    expect(calls).toHaveLength(1);
    act(() => {
      calls[0]?.resolve();
    });
    await waitFor(() => {
      expect(isDisabled(button('Reboot'))).toBe(false);
    });
  });

  it('a refusal → an error with the code and message; a 501 → "not implemented by the emulator"; the dialog closed', async () => {
    const calls = held();
    renderActions({ id: 'i-1', state: 'running' });
    fireEvent.click(button('Terminate'));
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

    fireEvent.click(button('Reboot'));
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
