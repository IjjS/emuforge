import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import type { LambdaFunction } from '../api';
import { ConfigurationTab } from './configuration-tab';

// The tab "Configuration" as `s1` leaves it: its read-only content (issue 516, test criteria "Unit s1, then s3 —
// components/configuration-tab.test.tsx").

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: undefined };
const ROLE = 'arn:aws:iam::000000000000:role/service-role/orders-role-abc12345';

const ORDERS: LambdaFunction = {
  name: 'orders',
  durable: false,
  description: 'Takes the orders',
  memorySize: 256,
  timeout: 3,
  role: ROLE,
  environment: [
    { key: 'GREETING', value: 'hello-1' },
    { key: 'EXTRA', value: 'x' },
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

function renderTab(fn: LambdaFunction = ORDERS) {
  return render(<ConfigurationTab fn={fn} name={fn.name} connection={CONNECTION} ready />);
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

  it('"Environment variables" with the columns "Key" and "Value", each key and value as text in the read’s order', () => {
    renderTab();

    expect(screen.getByRole('heading', { level: 2, name: 'Environment variables' })).toBeInTheDocument();
    expect(
      variablesTable()
        .findColumnHeaders()
        .map((header) => norm(header.getElement().textContent)),
    ).toEqual(['Key', 'Value']);
    expect(variableRows()).toEqual([
      ['GREETING', 'hello-1'],
      ['EXTRA', 'x'],
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
