import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';

import type { AreaConnection } from '../../../components/emulator-line';
import type { LambdaFunction } from '../api';
import type { FunctionChange } from '../queries';
import { ConfigurationTab } from './configuration-tab';

// The tab "Configuration" with its read-only content and its actions (issue 516, test criteria "Unit s1, then s3 —
// components/configuration-tab.test.tsx", and "Unit s3 — components/configuration-tab.test.tsx").

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: undefined };

// The changes' hooks are stand-ins of this file that hold each change until the case answers it.
interface HeldChange {
  input: unknown;
  answer: (failure?: RequestFailure) => void;
}

const held = vi.hoisted(() => ({ changes: [] as unknown[] }));

function useStandInChange<Input>(): FunctionChange<Input> {
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
  useUpdateFunctionCode: () => useStandInChange(),
  useUpdateFunctionConfiguration: () => useStandInChange(),
}));

const changes = () => held.changes as HeldChange[];

beforeEach(() => {
  held.changes = [];
});

/** `content` inside an area root, as the page renders a tab, its flash dropped. */
function inArea(content: ReactNode): ReactNode {
  const root = { current: null as HTMLDivElement | null };
  const flash: PageFlash = { show: () => undefined, handOver: () => undefined };
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div
          ref={(element) => {
            root.current = element;
          }}
        >
          {content}
        </div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

const ROLE = 'arn:aws:iam::000000000000:role/service-role/orders-role-abc12345';

const ORDERS: LambdaFunction = {
  name: 'orders',
  durable: false,
  description: 'Takes the orders',
  memorySize: 256,
  timeout: 3,
  role: ROLE,
  environment: [
    { key: 'EXTRA', value: 'x' },
    { key: 'GREETING', value: 'hello-1' },
  ],
  url: { kind: 'none' },
};

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function section(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title });
  const container = createWrapper(document.body)
    .findAllContainers()
    .find((found) => found.getElement().contains(heading));
  expect(container).toBeDefined();
  return (container as NonNullable<typeof container>).getElement();
}

function pairs(title: string): [string, string][] {
  return (createWrapper(section(title)).findKeyValuePairs()?.findItems() ?? []).map((item) => [
    norm(item.findLabel()?.getElement().textContent),
    norm(item.findValue()?.getElement().textContent),
  ]);
}

function variablesTable() {
  const table = createWrapper(document.body).findTable();
  expect(table).not.toBeNull();
  return table as NonNullable<typeof table>;
}

/** The rows of "Environment variables", each cell's text. */
function variableRows(): string[][] {
  const table = variablesTable();
  return table
    .findRows()
    .map((_, row) => [1, 2].map((column) => norm(table.findBodyCell(row + 1, column)?.getElement().textContent)));
}

function renderTab(fn: LambdaFunction = ORDERS, ready = true) {
  const result = render(inArea(<ConfigurationTab fn={fn} name={fn.name} connection={CONNECTION} ready={ready} />));
  return {
    ...result,
    reread: (next: LambdaFunction) => {
      result.rerender(inArea(<ConfigurationTab fn={next} name={next.name} connection={CONNECTION} ready />));
    },
  };
}

describe('the tab "Configuration"', () => {
  it('"General configuration" with description, memory, timeout and the role with its copy control', () => {
    renderTab();

    expect(
      pairs('General configuration').map(([label, value]) => [label, value.replace(/^Copy Execution role /, '')]),
    ).toEqual([
      ['Description', 'Takes the orders'],
      ['Memory', '256 MB'],
      ['Timeout', '3 seconds'],
      ['Execution role', ROLE],
    ]);
    expect(
      within(section('General configuration')).getByRole('button', { name: /Copy Execution role/ }),
    ).toBeInTheDocument();
  });

  it('a description of none is "-"; a timeout of 1 is "1 second"', () => {
    const withoutDescription: LambdaFunction = { ...ORDERS, timeout: 1 };
    delete withoutDescription.description;
    renderTab(withoutDescription);

    expect(pairs('General configuration').slice(0, 3)).toEqual([
      ['Description', '-'],
      ['Memory', '256 MB'],
      ['Timeout', '1 second'],
    ]);
  });

  it('"Environment variables" with the columns "Key" and "Value", each key and value as text in the read’s order (by key, the read’s own)', () => {
    renderTab();

    expect(screen.getByRole('heading', { level: 2, name: 'Environment variables' })).toBeInTheDocument();
    expect(
      variablesTable()
        .findColumnHeaders()
        .map((header) => norm(header.getElement().textContent)),
    ).toEqual(['Key', 'Value']);
    expect(variableRows()).toEqual([
      ['EXTRA', 'x'],
      ['GREETING', 'hello-1'],
    ]);
  });

  it('no variables: "No environment variables" and "{name} has no environment variables."', () => {
    renderTab({ ...ORDERS, environment: [] });

    const empty = variablesTable().findEmptySlot()?.getElement();
    expect(empty).toBeDefined();
    expect(within(empty as HTMLElement).getByText('No environment variables')).toBeInTheDocument();
    expect(norm(within(empty as HTMLElement).getByText(/has no environment variables\.$/).textContent)).toBe(
      'orders has no environment variables.',
    );
  });

  it('a variable’s value <b>x</b> is shown as text, no element made from it', () => {
    renderTab({ ...ORDERS, environment: [{ key: 'MARKUP', value: '<b id="injected-516">x</b>' }] });

    expect(variableRows()).toEqual([['MARKUP', '<b id="injected-516">x</b>']]);
    expect(document.getElementById('injected-516')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('the actions of "Configuration"', () => {
  const EDITS = ['Edit general configuration', 'Edit environment variables'];

  it('not ready: each "Edit" is unavailable with "Wait until the function is ready."; ready: available', () => {
    const { reread } = renderTab(ORDERS, false);

    for (const name of EDITS) {
      const edit = screen.getByRole('button', { name });
      expect(edit.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(edit);
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    fireEvent.focus(screen.getByRole('button', { name: 'Edit general configuration' }));
    expect(document.body.textContent).toContain('Wait until the function is ready.');

    reread(ORDERS);
    for (const name of EDITS) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('"Edit" of "General configuration" opens its dialog; after a save the section shows the read, never the form', async () => {
    const { reread } = renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Edit general configuration' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit general configuration' });
    const description = createWrapper(dialog).findTextarea()?.findNativeTextarea().getElement() as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: 'typed in the form' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    act(() => {
      changes()[0]?.answer();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(pairs('General configuration')[0]).toEqual(['Description', 'Takes the orders']);
    expect(document.body.textContent).not.toContain('typed in the form');

    reread({ ...ORDERS, description: 'second', memorySize: 512 });
    expect(pairs('General configuration').slice(0, 2)).toEqual([
      ['Description', 'second'],
      ['Memory', '512 MB'],
    ]);
  });

  it('"Edit" of "Environment variables" opens its dialog; after a save the section shows the read, never the form', async () => {
    const { reread } = renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Edit environment variables' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit environment variables' });
    const value = createWrapper(dialog)
      .findAttributeEditor()
      ?.findRow(1)
      ?.findField(2)
      ?.findControl()
      ?.findInput()
      ?.findNativeInput()
      .getElement() as HTMLInputElement;
    fireEvent.change(value, { target: { value: 'typed-in-the-form' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    act(() => {
      changes()[0]?.answer();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(variableRows()).toEqual([
      ['EXTRA', 'x'],
      ['GREETING', 'hello-1'],
    ]);
    expect(document.body.textContent).not.toContain('typed-in-the-form');

    reread({
      ...ORDERS,
      environment: [
        { key: 'AAA', value: '0' },
        { key: 'EXTRA', value: 'x' },
        { key: 'GREETING', value: 'hello-1' },
      ],
    });
    expect(variableRows()).toEqual([
      ['AAA', '0'],
      ['EXTRA', 'x'],
      ['GREETING', 'hello-1'],
    ]);
  });
});
