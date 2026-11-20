import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Route } from '../api';
import { RoutesTable } from './routes-table';

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

const ROUTES: Route[] = [
  { destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' },
  { destination: { kind: 'ipv4', value: '0.0.0.0/0' }, target: 'igw-1', state: 'blackhole' },
  { destination: { kind: 'ipv6', value: '::/0' }, target: 'nat-1', state: 'pending' },
  { destination: { kind: 'prefix-list', value: 'pl-1' }, target: 'vpce-1', state: 'active' },
  { destination: { kind: 'ipv4', value: '10.9.0.0/16' }, target: 'pcx-1', state: 'active' },
];

function rows(container: HTMLElement): string[][] {
  return (createWrapper(container).findTable()?.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].filter((cell) => cell.querySelector('input') === null).map(text),
  );
}

function statusOf(container: HTMLElement, row: number) {
  return createWrapper(container).findTable()?.findBodyCell(row, 3)?.findStatusIndicator()?.getElement();
}

describe('the routes', () => {
  it('a row each in the given order with "Destination", "Target", "State"; targets and destinations as the API gave them', () => {
    const { container } = render(<RoutesTable routes={ROUTES} />);
    const headers = (createWrapper(container).findTable()?.findColumnHeaders() ?? []).map((h) => text(h.getElement()));
    expect(headers).toEqual(['Destination', 'Target', 'State']);
    expect(rows(container)).toEqual([
      ['10.0.0.0/16', 'local', 'active'],
      ['0.0.0.0/0', 'igw-1', 'blackhole'],
      ['::/0', 'nat-1', 'pending'],
      ['pl-1', 'vpce-1', 'active'],
      ['10.9.0.0/16', 'pcx-1', 'active'],
    ]);
  });

  it('active with the success status, blackhole with the warning status, another state as it came', () => {
    const { container } = render(<RoutesTable routes={ROUTES} />);
    const wrapper = createWrapper(container).findTable();
    const status = (row: number) => wrapper?.findBodyCell(row, 3)?.findStatusIndicator();
    expect(status(1)?.getElement().className).toMatch(/success/);
    expect(status(2)?.getElement().className).toMatch(/warning/);
    expect(statusOf(container, 3)).toBeUndefined();
  });

  it('given no selection → no row can be selected', () => {
    render(<RoutesTable routes={ROUTES} />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('given one → one row at a time, told to the page', () => {
    const told = vi.fn<(route: Route | undefined) => void>();
    function Selecting() {
      const [selected, setSelected] = useState<Route>();
      return (
        <RoutesTable
          routes={ROUTES}
          selection={{
            selected,
            onChange: (route) => {
              told(route);
              setSelected(route);
            },
          }}
        />
      );
    }
    render(<Selecting />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(ROUTES.length);
    fireEvent.click(radios[1] as HTMLElement);
    expect(told).toHaveBeenLastCalledWith(ROUTES[1]);
    fireEvent.click(radios[3] as HTMLElement);
    expect(told).toHaveBeenLastCalledWith(ROUTES[3]);
    expect(screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
  });
});
