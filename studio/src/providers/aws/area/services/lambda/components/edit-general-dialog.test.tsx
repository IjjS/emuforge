import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import type { ConfigurationChange, LambdaFunction } from '../api';
import type { ChangeCallbacks, FunctionChange } from '../queries';
import { EditGeneralDialog } from './edit-general-dialog';

// "Edit" of "General configuration" (issue 516, test criteria "Unit s3 — components/edit-general-dialog.test.tsx"). The
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
  description: 'first',
  memorySize: 128,
  timeout: 3,
  environment: [],
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
        <EditGeneralDialog
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
  return screen.findByRole('dialog', { name: 'Edit general configuration' });
}

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function field(dialog: HTMLElement, label: string) {
  const found = createWrapper(dialog)
    .findAllFormFields()
    .find((formField) => norm(formField.findLabel()?.getElement().textContent) === label);
  if (found === undefined) throw new Error(`No field ${label}`);
  return found;
}

/** The native control of the field `label`: the description's text area or a number's input. */
function control(dialog: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = field(dialog, label).findControl();
  const element =
    found?.findTextarea()?.findNativeTextarea().getElement() ?? found?.findInput()?.findNativeInput().getElement();
  if (element === undefined) throw new Error(`No control of ${label}`);
  return element;
}

function type(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(control(dialog, label), { target: { value } });
}

const errorOf = (dialog: HTMLElement, label: string) =>
  norm(field(dialog, label).findError()?.getElement().textContent);

function button(dialog: HTMLElement, name: string): HTMLElement {
  return within(dialog).getByRole('button', { name });
}

describe('the dialog "Edit general configuration"', () => {
  it('opened: the fields hold the last read; each shows its constraint text', async () => {
    renderDialog();
    const dialog = await openDialog();

    expect(control(dialog, 'Description').value).toBe('first');
    expect(control(dialog, 'Memory (MB)').value).toBe('128');
    expect(control(dialog, 'Timeout (seconds)').value).toBe('3');
    expect(
      ['Description', 'Memory (MB)', 'Timeout (seconds)'].map((label) =>
        norm(field(dialog, label).findConstraint()?.getElement().textContent),
      ),
    ).toEqual(['Up to 256 characters.', 'A whole number from 128 to 10240.', 'A whole number from 1 to 900.']);
  });

  it('values the form refuses: each message at its field, focus on the first, nothing sent', async () => {
    renderDialog();
    const dialog = await openDialog();
    type(dialog, 'Memory (MB)', '127');
    type(dialog, 'Timeout (seconds)', '901');

    fireEvent.click(button(dialog, 'Save'));

    expect(errorOf(dialog, 'Description')).toBe('');
    expect(errorOf(dialog, 'Memory (MB)')).toBe('Enter a whole number from 128 to 10240.');
    expect(errorOf(dialog, 'Timeout (seconds)')).toBe('Enter a whole number from 1 to 900.');
    expect(document.activeElement).toBe(control(dialog, 'Memory (MB)'));
    expect(changes()).toEqual([]);

    type(dialog, 'Description', 'd'.repeat(257));
    fireEvent.click(button(dialog, 'Save'));
    expect(errorOf(dialog, 'Description')).toBe('The description can have up to 256 characters.');
    expect(document.activeElement).toBe(control(dialog, 'Description'));
    expect(changes()).toEqual([]);
  });

  it('"Save": one request with description, memory and timeout only; answered: closes, the Flashbar, focus on "Edit"', async () => {
    renderDialog();
    const dialog = await openDialog();
    type(dialog, 'Description', 'second');
    type(dialog, 'Memory (MB)', '256');
    type(dialog, 'Timeout (seconds)', '1');

    fireEvent.click(button(dialog, 'Save'));

    expect(changes().map(({ input }) => input)).toEqual([{ description: 'second', memorySize: 256, timeout: 1 }]);
    act(() => {
      changes()[0]?.answer();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(shown).toEqual([[{ type: 'success', content: 'General configuration of orders saved.' }]]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });

  it('a refusal of the emulator: the dialog stays with the code and message, the fields as typed', async () => {
    renderDialog();
    const dialog = await openDialog();
    type(dialog, 'Description', 'typed');
    fireEvent.click(button(dialog, 'Save'));

    act(() => {
      changes()[0]?.answer({
        kind: 'other',
        operation: 'UpdateFunctionConfiguration',
        code: 'ResourceConflictException',
        message: 'An update is in progress for resource: orders',
      });
    });

    expect(screen.getByRole('dialog', { name: 'Edit general configuration' })).toBe(dialog);
    expect(norm(createWrapper(dialog).findAlert()?.findContent().getElement().textContent)).toBe(
      'ResourceConflictException: An update is in progress for resource: orders',
    );
    expect(control(dialog, 'Description').value).toBe('typed');
    expect(shown).toEqual([]);
  });

  it.each(['Cancel', 'Escape', 'the close control'])('%s: nothing sent, focus on "Edit"', async (how) => {
    renderDialog();
    const dialog = await openDialog();

    if (how === 'Cancel') {
      fireEvent.click(button(dialog, 'Cancel'));
    } else if (how === 'Escape') {
      fireEvent.keyDown(control(dialog, 'Description'), { key: 'Escape', keyCode: 27 });
    } else {
      fireEvent.click(button(dialog, 'Close'));
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
