import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import type { ConfigurationChange, LambdaFunction } from '../api';
import type { ChangeCallbacks, FunctionChange } from '../queries';
import { EditRuntimeDialog } from './edit-runtime-dialog';

// "Edit" of "Runtime settings" (issue 516, test criteria "Unit s3 — components/edit-runtime-dialog.test.tsx"). The
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
  runtime: 'python3.13',
  handler: 'lambda_function.lambda_handler',
  architectures: ['x86_64'],
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
        <EditRuntimeDialog
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
  return screen.findByRole('dialog', { name: 'Edit runtime settings' });
}

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function field(dialog: HTMLElement, label: string) {
  const found = createWrapper(dialog)
    .findAllFormFields()
    .find((formField) => norm(formField.findLabel()?.getElement().textContent) === label);
  if (found === undefined) throw new Error(`No field ${label}`);
  return found;
}

function handlerInput(dialog: HTMLElement): HTMLInputElement {
  return field(dialog, 'Handler').findControl()?.findInput()?.findNativeInput().getElement() as HTMLInputElement;
}

function selectedRuntime(dialog: HTMLElement): string {
  return norm(field(dialog, 'Runtime').findControl()?.findSelect()?.findTrigger().getElement().textContent);
}

function runtimeLabels(dialog: HTMLElement): string[] {
  const select = field(dialog, 'Runtime').findControl()?.findSelect();
  select?.openDropdown();
  const labels = (select?.findDropdown().findOptions() ?? []).map((option) =>
    norm(option.findLabel().getElement().textContent),
  );
  return labels;
}

function button(dialog: HTMLElement, name: string): HTMLElement {
  return within(dialog).getByRole('button', { name });
}

describe('the dialog "Edit runtime settings"', () => {
  it('opened: the fields hold the last read; "Handler" shows its constraint text', async () => {
    renderDialog();
    const dialog = await openDialog();

    expect(selectedRuntime(dialog)).toBe('Python 3.13');
    expect(handlerInput(dialog).value).toBe('lambda_function.lambda_handler');
    expect(norm(field(dialog, 'Handler').findConstraint()?.getElement().textContent)).toBe(
      '1 to 128 characters, no spaces.',
    );
  });

  it('a handler the form refuses: its message at the field, focus on it, nothing sent', async () => {
    renderDialog();
    const dialog = await openDialog();
    fireEvent.change(handlerInput(dialog), { target: { value: 'index .handler' } });

    fireEvent.click(button(dialog, 'Save'));

    expect(norm(field(dialog, 'Handler').findError()?.getElement().textContent)).toBe(
      'The handler cannot contain spaces.',
    );
    expect(document.activeElement).toBe(handlerInput(dialog));
    expect(changes()).toEqual([]);
  });

  it('"Save": one request with runtime and handler only; answered: closes, the Flashbar, focus on "Edit"', async () => {
    renderDialog();
    const dialog = await openDialog();
    const select = field(dialog, 'Runtime').findControl()?.findSelect();
    select?.openDropdown();
    select?.selectOptionByValue('python3.12');
    fireEvent.change(handlerInput(dialog), { target: { value: 'lambda_function.other' } });

    fireEvent.click(button(dialog, 'Save'));

    expect(changes().map(({ input }) => input)).toEqual([{ runtime: 'python3.12', handler: 'lambda_function.other' }]);
    act(() => {
      changes()[0]?.answer();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(shown).toEqual([[{ type: 'success', content: 'Runtime settings of orders saved.' }]]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' }));
  });

  it('a refusal of the emulator: the dialog stays with the code and message, the fields as typed', async () => {
    renderDialog();
    const dialog = await openDialog();
    fireEvent.change(handlerInput(dialog), { target: { value: 'typed.handler' } });
    fireEvent.click(button(dialog, 'Save'));

    act(() => {
      changes()[0]?.answer({
        kind: 'other',
        operation: 'UpdateFunctionConfiguration',
        code: 'ResourceConflictException',
        message: 'An update is in progress for resource: orders',
      });
    });

    expect(screen.getByRole('dialog', { name: 'Edit runtime settings' })).toBe(dialog);
    expect(norm(createWrapper(dialog).findAlert()?.findContent().getElement().textContent)).toBe(
      'ResourceConflictException: An update is in progress for resource: orders',
    );
    expect(handlerInput(dialog).value).toBe('typed.handler');
    expect(shown).toEqual([]);
  });

  it.each(['Cancel', 'Escape', 'the close control'])('%s: nothing sent, focus on "Edit"', async (how) => {
    renderDialog();
    const dialog = await openDialog();

    if (how === 'Cancel') {
      fireEvent.click(button(dialog, 'Cancel'));
    } else if (how === 'Escape') {
      fireEvent.keyDown(handlerInput(dialog), { key: 'Escape', keyCode: 27 });
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

  it('a function of java21: "Runtime" holds the ten and java21, selected', async () => {
    renderDialog({ fn: { ...ORDERS, runtime: 'java21' } });
    const dialog = await openDialog();

    expect(selectedRuntime(dialog)).toBe('java21');
    expect(runtimeLabels(dialog)).toEqual([
      'Node.js 24.x',
      'Node.js 22.x',
      'Node.js 20.x',
      'Node.js 18.x',
      'Python 3.14',
      'Python 3.13',
      'Python 3.12',
      'Python 3.11',
      'Python 3.10',
      'Python 3.9',
      'java21',
    ]);
  });

  it('not ready: "Save" is unavailable with "Wait until the function is ready."; nothing sent', async () => {
    renderDialog({ ready: false });
    const dialog = await openDialog();

    const save = button(dialog, 'Save');
    expect(save.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(save);
    expect(changes()).toEqual([]);
    fireEvent.focus(save);
    expect(document.body.textContent).toContain('Wait until the function is ready.');
  });
});
