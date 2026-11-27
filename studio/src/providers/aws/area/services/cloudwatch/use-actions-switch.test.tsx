import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { PageFlashContext, type FlashItem, type FlashResult } from '../../components/page-flash';
import type { Alarm } from './alarm';
import { setAlarmActions } from './try-api';
import { useActionsSwitch } from './use-actions-switch';

vi.mock('./try-api', async (load) => ({
  ...(await load<typeof import('./try-api')>()),
  setAlarmActions: vi.fn(),
}));

const write = vi.mocked(setAlarmActions);
const endpoint = 'http://127.0.0.1:9685';
const name = 'an alarm';

beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined);
});

function open(actionsEnabled: boolean) {
  const show = vi.fn<(result: FlashResult) => void>();
  const refreshAlarm = vi.fn<Parameters<typeof useActionsSwitch>[0]['refreshAlarm']>();
  const refreshHistory = vi.fn();
  const wrapper = ({ children }: PropsWithChildren) => (
    <PageFlashContext.Provider value={{ show, handOver: vi.fn() }}>{children}</PageFlashContext.Provider>
  );
  const { result, rerender } = renderHook(
    ({ enabled }) => useActionsSwitch({ endpoint, name, actionsEnabled: enabled, refreshAlarm, refreshHistory }),
    { wrapper, initialProps: { enabled: actionsEnabled } },
  );
  return {
    result,
    refreshAlarm,
    refreshHistory,
    show,
    rerender,
    toggle: () => act(() => result.current.toggle()),
  };
}

function answer(ActionsEnabled: boolean): { value: Alarm } {
  return { value: { type: 'metric', data: { AlarmName: name, ActionsEnabled } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function expectResult(show: ReturnType<typeof open>['show'], type: FlashItem['type'], text: string) {
  expect(show).toHaveBeenCalledOnce();
  const item = show.mock.calls[0]?.[0][0];
  expect(item?.type).toBe(type);
  const content = document.createElement('div');
  content.innerHTML = renderToStaticMarkup(<>{item?.content}</>);
  expect(content.textContent).toBe(text);
}

it.each([
  [true, 'off'],
  [false, 'on'],
] as const)('announces success turning actions %s to %s only on confirmation', async (enabled, direction) => {
  const { toggle, refreshAlarm, refreshHistory, show } = open(enabled);
  refreshAlarm.mockResolvedValueOnce(answer(!enabled));
  await toggle();
  expect(write).toHaveBeenCalledExactlyOnceWith(endpoint, name, !enabled, expect.any(AbortSignal));
  expect(refreshAlarm).toHaveBeenCalledOnce();
  expect(refreshHistory).toHaveBeenCalledOnce();
  expectResult(show, 'success', `Actions of ${name} turned ${direction}.`);
});

it('announces nothing when the alarm is gone', async () => {
  const { toggle, refreshAlarm, show } = open(true);
  refreshAlarm.mockResolvedValueOnce({ value: undefined });
  await toggle();
  expect(show).not.toHaveBeenCalled();
});

it.each([
  [true, 'on'],
  [false, 'off'],
] as const)('warns when actions %s are still %s', async (enabled, direction) => {
  const { toggle, refreshAlarm, show } = open(enabled);
  refreshAlarm.mockResolvedValueOnce(answer(enabled));
  await toggle();
  expectResult(show, 'warning', `Actions of ${name} are still ${direction}.`);
});

it('announces that the change is unconfirmed on a failed read and stays quiet when a later read succeeds', async () => {
  const { toggle, refreshAlarm, rerender, show } = open(true);
  refreshAlarm.mockResolvedValueOnce({
    failure: { kind: 'other', operation: 'DescribeAlarms', code: 'ReadFailed' },
  });
  await toggle();
  rerender({ enabled: false });
  expectResult(
    show,
    'info',
    'The request was accepted. The alarm could not be read again, so the change is not confirmed.',
  );
});

it('reports a refusal without starting either read', async () => {
  write.mockRejectedValueOnce(
    new RequestError({
      kind: 'access-denied',
      operation: 'EnableAlarmActions',
      message: 'Actions cannot be enabled.',
    }),
  );
  const { toggle, refreshAlarm, refreshHistory, show } = open(false);
  await toggle();
  expectResult(show, 'error', 'EnableAlarmActions was refused: Actions cannot be enabled.');
  expect(refreshAlarm).not.toHaveBeenCalled();
  expect(refreshHistory).not.toHaveBeenCalled();
});

it('reports a 501 and marks the operation unavailable', async () => {
  write.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DisableAlarmActions' }));
  const { toggle, result, show } = open(true);
  await toggle();
  expectResult(show, 'info', 'The emulator answered 501 Not Implemented for DisableAlarmActions.');
  expect(show.mock.calls[0]?.[0][0].header).toBe('Not implemented by the emulator');
  expect(result.current.unavailable).toBe(true);
  await toggle();
  expect(write).toHaveBeenCalledOnce();
});

it('does not send a second write while writing or awaiting confirmation', async () => {
  const written = deferred<void>();
  const reread = deferred<ReturnType<typeof answer>>();
  write.mockReturnValueOnce(written.promise);
  const { result, refreshAlarm, show } = open(true);
  refreshAlarm.mockReturnValueOnce(reread.promise);
  let first!: Promise<void>;
  act(() => {
    first = result.current.toggle();
    void result.current.toggle();
  });
  expect(result.current.pending).toBe(true);
  expect(refreshAlarm).not.toHaveBeenCalled();
  await act(async () => written.resolve(undefined));
  expect(refreshAlarm).toHaveBeenCalledOnce();
  expect(result.current.pending).toBe(true);
  await act(() => result.current.toggle());
  expect(write).toHaveBeenCalledOnce();
  expect(show).not.toHaveBeenCalled();
  await act(async () => {
    reread.resolve(answer(false));
    await first;
  });
  expect(result.current.pending).toBe(false);
  expectResult(show, 'success', `Actions of ${name} turned off.`);
});
