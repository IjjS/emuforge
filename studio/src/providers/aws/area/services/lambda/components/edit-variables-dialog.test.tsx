import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import type { ConfigurationChange, LambdaFunction } from '../api';
import type { ChangeCallbacks, FunctionChange } from '../queries';
import { EditVariablesDialog } from './edit-variables-dialog';

// "Edit" of "Environment variables" (issue 516, test criteria "Unit s3 — components/edit-variables-dialog.test.tsx"). The
// dialog is opened from a stand-in "Edit" of this file, as the tab opens it; the save's hook is a stand-in that holds
// each change until the case answers it (the request it stands for is `api.test.ts`'s).

interface HeldChange {
  input: ConfigurationChange;
  callbacks: ChangeCallbacks | undefined;
  answer: (failure?: RequestFailure) => void;
}

const held = vi.hoisted(() => ({ changes: [] as unknown[] }));

function useStandInChange(): FunctionChange<ConfigurationChange> {
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    error: undefined,
    reset: () => undefined,
    mutate: (input, callbacks) => {
      if (isPending) {
        return;
      }
      setPending(true);
      held.changes.push({
        input,
        callbacks,
        answer: (failure?: RequestFailure) => {
          setPending(false);
          if (failure === undefined) {
            callbacks?.onSuccess?.();
          } else {
            callbacks?.onError?.(failure);
          }
        },
      });
    },
  };
}

vi.mock('../queries', () => ({
  useUpdateFunctionConfiguration: () => useStandInChange(),
}));

const changes = () => held.changes as HeldChange[];

const ORDERS: LambdaFunction = {
  name: 'orders',
  durable: false,
  environment: [
    { key: 'GREETING', value: 'hello-1' },
    { key: 'EXTRA', value: 'x' },
  ],
  url: { kind: 'none' },
};

let shown: FlashResult[];

function Opener({ fn, ready }: { fn: LambdaFunction; ready: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        id="edit"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit
      </button>
      {open && (
        <EditVariablesDialog
          fn={fn}
          name={fn.name}
          engineOrigin="http://127.0.0.1:8999"
          ready={ready}
          onClose={() => {
            setOpen(false);
            document.getElementById('edit')?.focus();
          }}
        />
      )}
    </>
  );
}

function renderDialog({ fn = ORDERS, ready = true }: { fn?: LambdaFunction; ready?: boolean } = {}) {
  const flash: PageFlash = {
    show: (result) => {
      shown.push(result);
    },
    handOver: () => undefined,
  };
  const root = { current: null as HTMLDivElement | null };
  render(
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div
          ref={(element) => {
            root.current = element;
          }}
        >
          <Opener fn={fn} ready={ready} />
        </div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>,
  );
}

beforeEach(() => {
  held.changes = [];
  shown = [];
});

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit environment variables' });
}

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function editor(dialog: HTMLElement) {
  const found = createWrapper(dialog).findAttributeEditor();
  if (found === null) throw new Error('No rows');
  return found;
}

/** The native input of row `row` (from 1), column `column` (1 the key, 2 the value). */
function input(dialog: HTMLElement, row: number, column: 1 | 2): HTMLInputElement {
  const element = editor(dialog)
    .findRow(row)
    ?.findField(column)
    ?.findControl()
    ?.findInput()
    ?.findNativeInput()
    .getElement();
  if (element === undefined) throw new Error(`No input at ${String(row)}, ${String(column)}`);
  return element;
}

/** Each row's key and value as typed. */
function rows(dialog: HTMLElement): [string, string][] {
  return editor(dialog)
    .findRows()
    .map((_, index) => [input(dialog, index + 1, 1).value, input(dialog, index + 1, 2).value]);
}

/** Each row's message at its key, '' for none. */
function keyErrors(dialog: HTMLElement): string[] {
  return editor(dialog)
    .findRows()
    .map((row) => norm(row.findField(1)?.findError()?.getElement().textContent));
}

function type(dialog: HTMLElement, row: number, column: 1 | 2, value: string) {
  fireEvent.change(input(dialog, row, column), { target: { value } });
}

function addRow(dialog: HTMLElement) {
  fireEvent.click(editor(dialog).findAddButton().getElement());
}

function removeRow(dialog: HTMLElement, row: number) {
  const remove = editor(dialog).findRow(row)?.findRemoveButton()?.getElement();
  if (remove === undefined) throw new Error(`No "Remove" in row ${String(row)}`);
  fireEvent.click(remove);
}

function button(dialog: HTMLElement, name: string): HTMLElement {
  return within(dialog).getByRole('button', { name });
}

describe('the dialog "Edit environment variables"', () => {
  it('opened: a row per variable of the last read, in its order', async () => {
    renderDialog();
    const dialog = await openDialog();

    expect(rows(dialog)).toEqual([
      ['GREETING', 'hello-1'],
      ['EXTRA', 'x'],
    ]);
  });

  it('rows the form refuses: the message at the key, focus on the first such key, nothing sent', async () => {
    renderDialog();
    const dialog = await openDialog();
    addRow(dialog);
    type(dialog, 3, 2, 'no key');
    addRow(dialog);
    type(dialog, 4, 1, 'GREETING');

    fireEvent.click(button(dialog, 'Save'));

    expect(keyErrors(dialog)).toEqual(['', '', 'Enter a key.', 'This key is already used.']);
    expect(document.activeElement).toBe(input(dialog, 3, 1));
    expect(changes()).toEqual([]);
  });

  it('"Save": one request with the whole map of the rows only; answered: closes, the Flashbar, focus on "Edit"', async () => {
    renderDialog();
    const dialog = await openDialog();
    type(dialog, 1, 2, 'hello-2');
    removeRow(dialog, 2);
    addRow(dialog);
    type(dialog, 2, 1, 'NEW');
    type(dialog, 2, 2, '');

    fireEvent.click(button(dialog, 'Save'));

    expect(changes().map(({ input: sent }) => sent)).toEqual([
      {
        variables: [
          { key: 'GREETING', value: 'hello-2' },
          { key: 'NEW', value: '' },
        ],
      },
    ]);
    act(() => {
      changes()[0]?.answer();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(shown).toEqual([[{ type: 'success', content: 'Environment variables of orders saved.' }]]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });

  it('"Add variable" adds a row; "Remove" removes its row; every row removed and "Save": an empty map is sent', async () => {
    renderDialog();
    const dialog = await openDialog();

    addRow(dialog);
    expect(rows(dialog)).toEqual([
      ['GREETING', 'hello-1'],
      ['EXTRA', 'x'],
      ['', ''],
    ]);
    removeRow(dialog, 1);
    expect(rows(dialog)).toEqual([
      ['EXTRA', 'x'],
      ['', ''],
    ]);
    removeRow(dialog, 2);
    removeRow(dialog, 1);
    expect(rows(dialog)).toEqual([]);

    fireEvent.click(button(dialog, 'Save'));

    expect(changes().map(({ input: sent }) => sent)).toEqual([{ variables: [] }]);
  });

  it('a refusal of the emulator: the dialog stays with the code and message, the rows as typed', async () => {
    renderDialog();
    const dialog = await openDialog();
    addRow(dialog);
    type(dialog, 3, 1, 'AWS_REGION');
    type(dialog, 3, 2, 'x');
    fireEvent.click(button(dialog, 'Save'));

    const message =
      'Lambda was unable to configure your environment variables because the environment variables you have provided contains reserved keys that are currently not supported for modification. Reserved keys used in this request: AWS_REGION';
    act(() => {
      changes()[0]?.answer({
        kind: 'other',
        operation: 'UpdateFunctionConfiguration',
        code: 'InvalidParameterValueException',
        message,
      });
    });

    expect(screen.getByRole('dialog', { name: 'Edit environment variables' })).toBe(dialog);
    expect(norm(createWrapper(dialog).findAlert()?.findContent().getElement().textContent)).toBe(
      `InvalidParameterValueException: ${message}`,
    );
    expect(rows(dialog)).toEqual([
      ['GREETING', 'hello-1'],
      ['EXTRA', 'x'],
      ['AWS_REGION', 'x'],
    ]);
    expect(shown).toEqual([]);
  });

  it.each(['Cancel', 'Escape', 'the close control'])('%s: nothing sent, focus on "Edit"', async (how) => {
    renderDialog();
    const dialog = await openDialog();

    if (how === 'Cancel') {
      fireEvent.click(button(dialog, 'Cancel'));
    } else if (how === 'Escape') {
      fireEvent.keyDown(input(dialog, 1, 1), { key: 'Escape', keyCode: 27 });
    } else {
      fireEvent.click(button(dialog, 'Close modal'));
    }

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(changes()).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });

  it('while a save is in flight "Save" is unavailable and a second press sends nothing', async () => {
    renderDialog();
    const dialog = await openDialog();

    fireEvent.click(button(dialog, 'Save'));
    expect(changes()).toHaveLength(1);

    const save = within(dialog).getByRole('button', { name: /^Sav/ });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    expect(changes()).toHaveLength(1);
  });
});
