// Studio's status rows (issue 60, test-criteria.md, "Unit — ui/status-rows.test.tsx"): the address a row shows is the
// address as it is, whatever break point the row draws in it (requirement R6), "-" with "Not known" for an address
// that is not known, and the list read in order (R5.6). Where the address is drawn and how it breaks are the flow
// check's (tests/integration/studio/addresses.spec.ts): jsdom lays nothing out.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LanguageProvider } from '../i18n/language-provider';
import { StatusRow, StatusRows } from './status-rows';

function renderRows(rows: { label: string; status: string; address: string | undefined }[]) {
  return render(
    <LanguageProvider>
      <StatusRows>
        {rows.map((r) => (
          <StatusRow key={r.label} label={r.label} kind="ok" status={r.status} address={r.address} />
        ))}
      </StatusRows>
    </LanguageProvider>,
  );
}

/** The definition of the row labelled `label`: its status and its address. */
function definitionOf(label: string): HTMLElement {
  const term = screen.getAllByRole('term').find((el) => el.textContent === label);
  const value = term?.nextElementSibling;
  if (!(value instanceof HTMLElement)) {
    throw new Error(`the "${label}" row has no definition`);
  }
  return value;
}

/** The element of the row labelled `label` that shows `address`, and what it reads. */
function addressOf(label: string, address: string): string | null {
  return within(definitionOf(label)).getByText(address, { exact: true }).textContent;
}

describe("Studio's status rows", () => {
  it.each([['https://127.0.0.1:65535'], ['http://127.0.0.1:8080']])(
    'a row with the address %s reads exactly that address',
    (address) => {
      renderRows([{ label: 'Emulator', status: 'Connected', address }]);

      expect(addressOf('Emulator', address)).toBe(address);
      expect(definitionOf('Emulator').textContent).toBe(`Connected${address}`);
    },
  );

  it('a row with no address shows "-", which a screen reader reads as "Not known"', () => {
    renderRows([{ label: 'Emulator', status: 'Unknown', address: undefined }]);

    const value = definitionOf('Emulator');
    const dash = within(value).getByText('-', { exact: true });
    expect(dash.closest('[aria-hidden="true"]')).not.toBeNull();
    const notKnown = within(value).getByText('Not known', { exact: true });
    expect(notKnown.closest('[aria-hidden="true"]')).toBeNull();
    expect(value.textContent).toBe('Unknown-Not known');
  });

  it('two rows read in order: "Engine", its status then address, "Emulator", its status then address', () => {
    const { container } = renderRows([
      { label: 'Engine', status: 'Connected', address: 'http://127.0.0.1:65535' },
      { label: 'Emulator', status: 'Connected', address: 'https://127.0.0.1:65534' },
    ]);

    const lists = container.querySelectorAll('dl');
    expect(lists).toHaveLength(1);
    const list = lists[0] as HTMLElement;
    const read = [...list.querySelectorAll('dt, dd')].map((el) => [el.tagName.toLowerCase(), el.textContent]);
    expect(read).toEqual([
      ['dt', 'Engine'],
      ['dd', 'Connectedhttp://127.0.0.1:65535'],
      ['dt', 'Emulator'],
      ['dd', 'Connectedhttps://127.0.0.1:65534'],
    ]);
    expect(
      within(list)
        .getAllByRole('term')
        .map((el) => el.textContent),
    ).toEqual(['Engine', 'Emulator']);
    expect(within(list).getAllByRole('definition')).toHaveLength(2);
  });
});
