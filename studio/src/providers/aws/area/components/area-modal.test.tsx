import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences from '@cloudscape-design/components/collection-preferences';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ButtonWrapper from '@cloudscape-design/components/test-utils/dom/button';
import ModalWrapper from '@cloudscape-design/components/test-utils/dom/modal';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../lib/engine/engine-client';
import { AreaRootContext } from '../area-root';
import { AreaModal, useAreaModalRoot } from './area-modal';
import type { AreaConnection } from './emulator-line';

// The area's `AreaModal` and its modal root (test-criteria.md, issue 462, "Unit —
// providers/aws/area/components/area-modal.test.tsx"). "A re-render of the page" is what a page of the area sees every
// 5 seconds: a new connection answer handed to it, a new object with the same state, or a change of state in the
// component that holds the dialog. "The same dialog" is the element found before, still in the document.

const ENGINE_ORIGIN = 'http://127.0.0.1:8462';

function connectedAnswer(): AreaConnection {
  const result: CheckResult = {
    kind: 'connected',
    checkedAt: Date.now(),
    emulator: { port: 9462, endpoint: 'https://127.0.0.1:9462' },
  };
  return { result, engineOrigin: ENGINE_ORIGIN };
}

/**
 * The area's root, as the area's layout holds it, and a page inside it that is handed the connection; what the page
 * renders sits in an element of its own, so what else is in the root is what the modals put there.
 */
function Area({ connection, children }: { connection: AreaConnection; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} data-testid="area-root">
      <AreaRootContext value={root}>
        <div data-testid="page" data-checked-at={connection.result?.checkedAt}>
          {children}
        </div>
      </AreaRootContext>
    </div>
  );
}

function areaRoot(): HTMLElement {
  return screen.getByTestId('area-root');
}

/** The elements of the area's root that the page did not render: the modals' containers. */
function containers(): Element[] {
  const page = screen.getByTestId('page');
  return [...areaRoot().children].filter((child) => child !== page);
}

function visibleDialogs(): HTMLElement[] {
  return screen.queryAllByRole('dialog').filter((dialog) => new ModalWrapper(dialog).isVisible());
}

/** Cloudscape's portal asks for the root once the commit that mounts the dialog is done. */
async function settle() {
  await act(() => Promise.resolve());
}

/** A dialog that holds a field bound to the state of the component around it, as a dialog of the area holds one. */
function DialogWithField() {
  const [text, setText] = useState('');
  return (
    <AreaModal visible header="Name the bucket" closeAriaLabel="Close modal">
      <Input
        ariaLabel="Bucket name"
        value={text}
        onChange={({ detail }) => {
          setText(detail.value);
        }}
      />
    </AreaModal>
  );
}

/** A dialog whose primary button starts something: the component around it holds the pending state. */
function DialogWithPending() {
  const [pending, setPending] = useState(false);
  return (
    <AreaModal
      visible
      header="Delete bucket"
      closeAriaLabel="Close modal"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link">Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              loadingText="Deleting bucket"
              onClick={() => {
                setPending(true);
              }}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      Nothing is deleted.
    </AreaModal>
  );
}

/** A dialog opened from a button and closed by its own answer, as a page of the area opens one. */
function OpenedFromButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete
      </Button>
      <AreaModal
        visible={open}
        header="Delete bucket"
        closeAriaLabel="Close modal"
        onDismiss={() => {
          setOpen(false);
        }}
      >
        Nothing is deleted.
      </AreaModal>
    </>
  );
}

/** A page's "Preferences", given the area's modal root as the pages of the area give it. */
function Preferences() {
  const modalRoot = useAreaModalRoot();
  const [pageSize, setPageSize] = useState(25);
  return (
    <CollectionPreferences
      {...modalRoot}
      title="Preferences"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      preferences={{ pageSize }}
      onConfirm={({ detail }) => {
        setPageSize(detail.pageSize ?? 25);
      }}
      pageSizePreference={{
        title: 'Page size',
        options: [
          { value: 10, label: '10 buckets' },
          { value: 25, label: '25 buckets' },
          { value: 50, label: '50 buckets' },
        ],
      }}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AreaModal, the area’s dialog', () => {
  it('a field focused, two characters typed one at a time, the component around it re-rendering with each: the same dialog and field, focus in it, both characters held (regression)', async () => {
    render(
      <Area connection={connectedAnswer()}>
        <DialogWithField />
      </Area>,
    );
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox', { name: 'Bucket name' });
    act(() => {
      input.focus();
    });

    fireEvent.change(input, { target: { value: 'a' } });
    await settle();
    fireEvent.change(input, { target: { value: 'ab' } });
    await settle();

    expect(dialog.isConnected).toBe(true);
    expect(input.isConnected).toBe(true);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByRole('textbox', { name: 'Bucket name' })).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue('ab');
  });

  it('its primary button turned to loading once pressed, by the component around it: the same dialog, the button shows progress (regression)', async () => {
    render(
      <Area connection={connectedAnswer()}>
        <DialogWithPending />
      </Area>,
    );
    const dialog = await screen.findByRole('dialog');
    const primary = within(dialog).getByRole('button', { name: 'Delete' });

    fireEvent.click(primary);
    await settle();

    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole('dialog')).toBe(dialog);
    const shown = within(dialog).getByRole('button', { name: /Delet/ });
    expect(shown).toBe(primary);
    expect(new ButtonWrapper(shown as HTMLButtonElement).findLoadingIndicator()).not.toBeNull();
    expect(shown).toHaveAttribute('aria-disabled', 'true');
  });

  it('focus on its second button, the page around it re-rendered by a new connection answer: the same dialog, focus on that button', async () => {
    const view = render(
      <Area connection={connectedAnswer()}>
        <DialogWithPending />
      </Area>,
    );
    const dialog = await screen.findByRole('dialog');
    // In the dialog's order: "Close modal", then "Cancel", then "Delete".
    const second = within(dialog).getAllByRole('button')[1] as HTMLElement;
    expect(second).toHaveAccessibleName('Cancel');
    act(() => {
      second.focus();
    });
    expect(document.activeElement).toBe(second);

    view.rerender(
      <Area connection={connectedAnswer()}>
        <DialogWithPending />
      </Area>,
    );
    await settle();

    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(second.isConnected).toBe(true);
    expect(document.activeElement).toBe(second);
  });

  it("opened inside the area: the dialog is inside the area's root, not directly under document.body", async () => {
    render(
      <Area connection={connectedAnswer()}>
        <DialogWithPending />
      </Area>,
    );

    const dialog = await screen.findByRole('dialog');
    const root = areaRoot();
    expect(root).toContainElement(dialog);
    expect([...document.body.children].every((child) => !child.contains(dialog) || child.contains(root))).toBe(true);
  });

  it('rendered with no area around it: no dialog is in the document', async () => {
    // Cloudscape's portal logs the rejected root ("[AwsUi] [portal]: failed to load portal root") and renders nothing.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<DialogWithPending />);
    await settle();
    await settle();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('open, closed and re-rendered twice while closed: at most one container of it in the root, no dialog visible; opened again: exactly one visible dialog', async () => {
    function Holder({ visible }: { visible: boolean }) {
      return (
        <AreaModal visible={visible} header="Delete bucket" closeAriaLabel="Close modal">
          Nothing is deleted.
        </AreaModal>
      );
    }
    const view = render(
      <Area connection={connectedAnswer()}>
        <Holder visible />
      </Area>,
    );
    await screen.findByRole('dialog');
    expect(visibleDialogs()).toHaveLength(1);

    // Closed, then re-rendered twice while closed.
    for (let pass = 0; pass < 3; pass += 1) {
      view.rerender(
        <Area connection={connectedAnswer()}>
          <Holder visible={false} />
        </Area>,
      );
      await settle();
    }
    expect(containers().length).toBeLessThanOrEqual(1);
    expect(visibleDialogs()).toHaveLength(0);

    view.rerender(
      <Area connection={connectedAnswer()}>
        <Holder visible />
      </Area>,
    );
    await settle();
    await waitFor(() => {
      expect(visibleDialogs()).toHaveLength(1);
    });
    expect(containers().length).toBeLessThanOrEqual(1);
  });

  it("open, then unmounted: nothing of it is left in the area's root", async () => {
    function Holder({ shown }: { shown: boolean }) {
      return shown ? (
        <AreaModal visible header="Delete bucket" closeAriaLabel="Close modal">
          Nothing is deleted.
        </AreaModal>
      ) : null;
    }
    const view = render(
      <Area connection={connectedAnswer()}>
        <Holder shown />
      </Area>,
    );
    await screen.findByRole('dialog');
    expect(containers()).toHaveLength(1);

    view.rerender(
      <Area connection={connectedAnswer()}>
        <Holder shown={false} />
      </Area>,
    );
    await settle();

    expect(containers()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opened from a button, then closed with Esc: focus is on that button', async () => {
    render(
      <Area connection={connectedAnswer()}>
        <OpenedFromButton />
      </Area>,
    );
    const opener = screen.getByRole('button', { name: 'Delete' });
    act(() => {
      opener.focus();
    });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await waitFor(() => {
      expect(visibleDialogs()).toHaveLength(0);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });
});

describe("useAreaModalRoot, the area's root for a Cloudscape component's own modal", () => {
  it('"Preferences" given it: opened, a page size chosen with the arrow keys, the page re-rendered: the same dialog, focus on the chosen size and it is still chosen; the dialog is in the area’s root (regression)', async () => {
    const user = userEvent.setup();
    const view = render(
      <Area connection={connectedAnswer()}>
        <Preferences />
      </Area>,
    );
    await user.click(screen.getByRole('button', { name: 'Preferences' }));
    const dialog = await screen.findByRole('dialog', { name: 'Preferences' });
    const chosen = within(dialog).getByRole('radio', { name: '25 buckets' });
    expect(chosen).toBeChecked();
    act(() => {
      chosen.focus();
    });

    await user.keyboard('{ArrowDown}');
    const fifty = within(dialog).getByRole('radio', { name: '50 buckets' });
    expect(fifty).toBeChecked();
    expect(document.activeElement).toBe(fifty);

    view.rerender(
      <Area connection={connectedAnswer()}>
        <Preferences />
      </Area>,
    );
    await settle();

    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBe(dialog);
    expect(fifty.isConnected).toBe(true);
    expect(document.activeElement).toBe(fifty);
    expect(fifty).toBeChecked();
    expect(areaRoot()).toContainElement(dialog);
  });
});
