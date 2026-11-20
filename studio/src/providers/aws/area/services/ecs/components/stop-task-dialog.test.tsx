import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../task-api';
import { StopTaskDialog } from './stop-task-dialog';

// The dialog sends `StopTask` itself; the call of `task-api.ts` is answered by the case.

vi.mock('../task-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../task-api')>();
  return { ...real, stopTask: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8311';

let onStopped: ReturnType<typeof vi.fn<(task: string) => void>>;
let onFailed: ReturnType<typeof vi.fn<(task: string, failure: RequestFailure) => void>>;
let onDismiss: ReturnType<typeof vi.fn<() => void>>;

/** The dialog inside an area's root, opened for the task `abc` by an opener that closes it only on "Cancel". */
function InArea() {
  const root = useRef<HTMLDivElement>(null);
  const [task, setTask] = useState<string | undefined>('abc');
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <StopTaskDialog
          task={task}
          cluster="dev"
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onStopped={onStopped}
          onFailed={onFailed}
          onDismiss={() => {
            onDismiss();
            setTask(undefined);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InArea />
    </QueryClientProvider>,
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  vi.clearAllMocks();
  onStopped = vi.fn();
  onFailed = vi.fn();
  onDismiss = vi.fn();
});

describe('"Stop task {task}?"', () => {
  it('open → its header, its body, "Cancel" and "Stop task", no field', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Stop task abc?');
    expect(text(dialog)).toContain('The task is stopped in the local emulator.');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Stop task' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('confirmed and answered → the dialog is no longer shown, and its opener is told once that the task is stopping', async () => {
    vi.mocked(api.stopTask).mockResolvedValue(undefined);
    open();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop task' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledWith('abc');
    expect(onFailed).not.toHaveBeenCalled();
    expect(vi.mocked(api.stopTask).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'dev', 'abc']);
  });

  it('confirmed and refused → the dialog is no longer shown, and its opener is told once of the failure, with its code and message', async () => {
    vi.mocked(api.stopTask).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'StopTask',
        code: 'InvalidParameterException',
        message: 'The referenced task was not found',
      }),
    );
    open();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop task' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith('abc', {
      kind: 'other',
      operation: 'StopTask',
      code: 'InvalidParameterException',
      message: 'The referenced task was not found',
    });
    expect(onStopped).not.toHaveBeenCalled();
  });

  it('while the request is out → neither button acts', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(api.stopTask).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop task' }));
    await waitFor(() => {
      expect(api.stopTask).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop task' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.stopTask).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    finish();
    await waitFor(() => {
      expect(onStopped).toHaveBeenCalledTimes(1);
    });
  });
});
