import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { ChoiceSelect, type ChoiceSelectProps } from './choice-select';
import type { AreaConnection } from './emulator-line';
import type { ChoiceFiltering, ChoiceSource } from './use-paged-choices';
import type { TokenPage } from './use-token-listing';

// The single field with a stand-in reader and stand-in words: the reader's answers are the case's.

const ENGINE = 'http://127.0.0.1:8398';
const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9398, endpoint: 'https://127.0.0.1:9398' } },
  engineOrigin: ENGINE,
};

interface Thing {
  id: string;
  name: string;
  size: string;
  note?: string;
  disabledReason?: string;
}

const thing = (id: string, name = id, size = '1', note?: string): Thing => ({
  id,
  name,
  size,
  ...(note === undefined ? {} : { note }),
});

type Reader = (text: string, token: string | undefined) => Promise<TokenPage<Thing>>;

let read: ReturnType<typeof vi.fn<Reader>>;
let chosen: (Thing | undefined)[];

function source(filtering: ChoiceFiltering | undefined): ChoiceSource<Thing> {
  return {
    key: ['test', 'things'],
    endpoint: ENGINE,
    operation: 'ListThings',
    filtering,
    read: (_endpoint, text, token) => read(text, token),
    optionOf: (each) => ({
      value: each.id,
      label: each.name,
      ...(each.note === undefined ? {} : { description: each.note }),
      tags: [each.id, `size ${each.size}`],
      ...(each.disabledReason === undefined ? {} : { disabled: true, disabledReason: each.disabledReason }),
    }),
  };
}

interface FieldOptions extends Pick<
  ChoiceSelectProps<Thing>,
  'fixed' | 'fixedDescription' | 'triggerVariant' | 'lockedBy' | 'none' | 'held' | 'onOpen'
> {
  filtering?: ChoiceFiltering;
  readAgainOnOpen?: boolean;
}

function Field({ filtering = 'sent', readAgainOnOpen, ...options }: FieldOptions) {
  const [value, setValue] = useState<Thing>();
  return (
    <ChoiceSelect<Thing>
      source={{ ...source(filtering), readAgainOnOpen }}
      connection={CONNECTION}
      things="things"
      placeholder="Choose a thing"
      value={value}
      {...options}
      onChange={(choice) => {
        chosen.push(choice);
        setValue(choice);
      }}
    />
  );
}

function open(options: FieldOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<Field {...options} />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return (changes: Partial<FieldOptions>) => view.rerender(<Field {...options} {...changes} />);
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function select() {
  const found = PAGE.findSelect();
  if (found === null) {
    throw new Error('no select');
  }
  return found;
}

function shown(): string[] {
  return (select().findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()));
}

function expectOptions(labelsByValue: Record<string, string>) {
  const dropdown = select().findDropdown();
  expect(dropdown.findOptions()).toHaveLength(Object.keys(labelsByValue).length);
  for (const [value, label] of Object.entries(labelsByValue)) {
    expect(text(dropdown.findOptionByValue(value)?.findLabel().getElement())).toBe(label);
  }
}

function dropdownText(): string {
  return text(select().findDropdown().getElement());
}

function statusText(): string {
  return select().findDropdown().findFooterRegion()?.getElement().textContent ?? '';
}

function triggerText(): string {
  return text(select().findTrigger().getElement());
}

beforeEach(() => {
  read = vi.fn<Reader>();
  chosen = [];
});

describe('ChoiceSelect', () => {
  it('labels choices with their identities and keeps the stored name as the selected value', async () => {
    const oneSpace = thing('a b');
    const twoSpaces = thing('a  b');
    const identity = 'a\\u0020\\u0020b';
    read.mockResolvedValue({ items: [oneSpace, twoSpaces] });
    open();
    select().openDropdown();
    await waitFor(() => expect(shown()).toEqual(['a b', identity]));

    expect(select().findDropdown().findOptionByValue(twoSpaces.id)?.findLabel().getElement().textContent).toBe(
      identity,
    );
    expect(select().findDropdown().findOptionByValue(oneSpace.id)?.findLabel().getElement().textContent).toBe('a b');
    select().selectOptionByValue(twoSpaces.id);
    expect(triggerText()).toBe(identity);
    expect(chosen).toEqual([twoSpaces]);
  });

  it('selects the two-space name by keyboard immediately after entering the filter', async () => {
    const oneSpace = thing('id-1', 'a b');
    const twoSpaces = thing('id-2', 'a  b');
    read.mockResolvedValue({ items: [oneSpace, twoSpaces] });
    open({ filtering: 'local' });
    select().openDropdown();
    await waitFor(() => expect(shown()).toEqual(['a b', 'a\\u0020\\u0020b']));

    const input = select().findFilteringInput();
    const native = input?.findNativeInput()?.getElement();
    if (!input || !native) throw new Error('no filtering input');
    act(() => native.focus());
    input.setInputValue(twoSpaces.name);
    expect(native).toHaveFocus();
    const dropdown = select().findDropdown();
    expect(dropdown.findOptionByValue(oneSpace.id)).toBeNull();
    expect(dropdown.findOptionByValue(twoSpaces.id)).not.toBeNull();
    fireEvent.keyDown(native, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
    fireEvent.keyDown(native, { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(chosen).toEqual([twoSpaces]);
    expect(triggerText()).toBe('a\\u0020\\u0020b');
  });

  it('filters by the stored name, id or description and shows the escaped label with the usual option details', async () => {
    const identity = 'a\\u0020\\u0020b';
    read.mockResolvedValue({ items: [thing('id-1', 'a b', '1', 'Primary'), thing('id-2', 'a  b', '2', 'Replica')] });
    open({ filtering: 'local' });
    select().openDropdown();
    await waitFor(() => expect(shown()).toEqual(['a b', identity]));

    const input = select().findFilteringInput();
    input?.setInputValue('a  b');
    await waitFor(() => expect(shown()).toEqual([identity]));
    const option = select().findDropdown().findOptionByValue('id-2')?.getElement();
    expect(option?.textContent).not.toContain('a  b');
    expect(option).toHaveTextContent(identity);
    expect(option).toHaveTextContent('Replica');
    expect(option).toHaveTextContent('id-2');
    expect(option).toHaveTextContent('size 2');

    input?.setInputValue('ID-1');
    await waitFor(() => expect(shown()).toEqual(['a b']));
    input?.setInputValue('Replica');
    await waitFor(() => expect(shown()).toEqual([identity]));
    input?.setInputValue('missing');
    expect(statusText()).toBe('No things match');
    input?.setInputValue('');
    await waitFor(() => expect(shown()).toEqual(['a b', identity]));
    expect(read.mock.calls).toEqual([['', undefined]]);
  });

  it('shows loading and retry for a local source and says "No things" when the successful read is empty', async () => {
    let reject: (error: Error) => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    read.mockResolvedValueOnce({ items: [] });
    open({ filtering: 'local' });
    select().openDropdown();
    await waitFor(() => expect(statusText()).toBe('Loading things'));

    reject(new RequestError({ kind: 'other', operation: 'ListThings', code: 'Broken' }));
    await waitFor(() => {
      const footer = select().findDropdown().findFooterRegion()?.getElement();
      const status = footer && createWrapper(footer).findStatusIndicator()?.getElement();
      expect(status?.textContent?.trim()).toBe('The things could not be loaded: Broken');
    });
    const retry = select().findErrorRecoveryButton();
    expect(retry?.getElement()).toHaveAccessibleName('Retry');
    retry?.click();
    await waitFor(() => expect(statusText()).toBe('No things'));
  });

  it('filters a fixed first choice even when the source is empty, restoring it when the text is cleared', async () => {
    read.mockResolvedValue({ items: [] });
    open({ filtering: 'local', fixed: 'No key pair' });
    select().openDropdown();
    await waitFor(() => expect(statusText()).toBe('No things'));

    const input = select().findFilteringInput();
    input?.setInputValue('missing');
    expect(statusText()).toBe('No things match');
    expect(shown()).toEqual([]);
    input?.setInputValue('');
    await waitFor(() => expect(shown()).toEqual(['No key pair']));
  });

  it('matches a fixed first choice by label alongside a source with options', async () => {
    read.mockResolvedValue({ items: [thing('id-1', 'existing key', '2', 'Replica')] });
    open({ filtering: 'local', fixed: 'No key pair' });
    select().openDropdown();
    await waitFor(() => expect(shown()).toEqual(['No key pair', 'existing key']));
    const option = select().findDropdown().findOptionByValue('id-1')?.getElement();
    expect(option).toHaveTextContent('Replica');
    expect(option).toHaveTextContent('size 2');

    select().findFilteringInput()?.setInputValue('pair');
    await waitFor(() => expect(shown()).toEqual(['No key pair']));
  });

  it('offers another page when a local filter hides the first page and narrows the new options too', async () => {
    read.mockResolvedValueOnce({ items: [thing('id-1', 'one')], next: 'next' });
    read.mockResolvedValueOnce({ items: [thing('id-2', 'a  b'), thing('id-3', 'three')] });
    open({ filtering: 'local' });
    select().openDropdown();
    await waitFor(() => expect(shown()).toEqual(['one']));

    select().findFilteringInput()?.setInputValue('a  b');
    await waitFor(() => expect(shown()).toEqual([]));
    const footer = select().findDropdownFooter()?.getElement();
    const loadMore = footer && createWrapper(footer).findButton();
    expect(loadMore?.getElement()).toHaveAccessibleName('Load more');
    loadMore?.click();
    await waitFor(() => expect(shown()).toEqual(['a\\u0020\\u0020b']));
    expect(read.mock.calls).toEqual([
      ['', undefined],
      ['', 'next'],
    ]);
  });

  it('sends the typed text with both spaces to a remote source', async () => {
    read.mockResolvedValue({ items: [] });
    open({ filtering: 'sent' });
    select().openDropdown();
    await waitFor(() => expect(read).toHaveBeenCalledWith('', undefined));
    select().findFilteringInput()?.setInputValue('a  b');
    await waitFor(() => expect(read).toHaveBeenLastCalledWith('a  b', undefined));
  });

  it('opened → "Loading {things}", then the first page\'s choices, each with its label and its further values', async () => {
    let answer: (page: TokenPage<Thing>) => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read).not.toHaveBeenCalled();
    expect(triggerText()).toBe('Choose a thing');
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('Loading things');
    });
    expect(read).toHaveBeenCalledWith('', undefined);
    act(() => {
      answer({ items: [thing('t-1', 'alpha', '2'), thing('t-2', 'beta')] });
    });
    await waitFor(() => {
      expect(shown()).toEqual(['alpha', 'beta']);
    });
    const first = select().findDropdown().findOptionByValue('t-1');
    expect(text(first?.getElement())).toContain('t-1');
    expect(text(first?.getElement())).toContain('size 2');
    select().selectOptionByValue('t-2');
    expect(chosen).toEqual([thing('t-2', 'beta')]);
    expect(triggerText()).toContain('beta');
  });

  it('"Load more" at the end while a token remains → the next page added below', async () => {
    read.mockResolvedValueOnce({ items: [thing('a')], next: 'tok-1' }).mockResolvedValueOnce({ items: [thing('b')] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['a']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(shown()).toEqual(['a', 'b']);
    });
    expect(read).toHaveBeenLastCalledWith('', 'tok-1');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('a text typed → the choices start again for that text; none → "No {things} match"; none without a text → "No {things}"', async () => {
    read.mockImplementation((typed) =>
      Promise.resolve(
        typed === ''
          ? { items: [thing('a')], next: 'tok-1' }
          : typed === 'or'
            ? { items: [thing('orders')] }
            : { items: [] },
      ),
    );
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['a']);
    });
    select().findFilteringInput()?.setInputValue('or');
    await waitFor(() => {
      expect(shown()).toEqual(['orders']);
    });
    expect(read).toHaveBeenLastCalledWith('or', undefined);
    select().findFilteringInput()?.setInputValue('zz');
    await waitFor(() => {
      expect(dropdownText()).toContain('No things match');
    });

    read.mockResolvedValue({ items: [] });
    select().findFilteringInput()?.setInputValue('');
    await waitFor(() => {
      expect(read).toHaveBeenLastCalledWith('', undefined);
    });
    await waitFor(() => {
      expect(dropdownText()).toContain('No things');
    });
    expect(dropdownText()).not.toContain('match');
  });

  it('a failed page → "The {things} could not be loaded" with "Retry", the choices already shown kept', async () => {
    read
      .mockResolvedValueOnce({ items: [thing('a')], next: 'tok-1' })
      .mockRejectedValueOnce(
        new RequestError({ kind: 'other', operation: 'ListThings', code: 'Throttling', message: 'slow' }),
      )
      .mockResolvedValueOnce({ items: [thing('b')] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['a']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdownText()).toContain('The things could not be loaded');
    });
    expect(dropdownText()).toContain('Throttling: slow');
    expect(shown()).toEqual(['a']);
    const retry = select().findErrorRecoveryButton();
    expect(text(retry?.getElement())).toBe('Retry');
    retry?.click();
    await waitFor(() => {
      expect(shown()).toEqual(['a', 'b']);
    });
    expect(read).toHaveBeenLastCalledWith('', 'tok-1');
  });

  it("a failed page that is not implemented names the operation; one refused shows the engine's reason", async () => {
    read
      .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'ListThings' }))
      .mockRejectedValueOnce(
        new RequestError({ kind: 'access-denied', operation: 'ListThings', message: 'User is not allowed to list' }),
      );
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain(
        'The things could not be loaded: Not implemented by the emulator. The emulator answered 501 Not Implemented for ListThings.',
      );
    });
    select().findErrorRecoveryButton()?.click();
    await waitFor(() => {
      expect(dropdownText()).toContain(
        'The things could not be loaded: Access denied. ListThings was refused: User is not allowed to list',
      );
    });
  });

  it('a field given no filter takes no typed text, and its choices are the pages read', async () => {
    read.mockResolvedValueOnce({ items: [thing('a'), thing('b')] });
    open({ filtering: 'none' });
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['a', 'b']);
    });
    expect(select().findFilteringInput()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a fixed first choice, when the field is given one, is offered above the others and is the choice at start', async () => {
    read.mockResolvedValueOnce({ items: [thing('a')] });
    open({ fixed: 'Nothing chosen' });
    expect(triggerText()).toBe('Nothing chosen');
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['Nothing chosen', 'a']);
    });
    select().selectOptionByValue('a');
    expect(triggerText()).toContain('a');
    select().openDropdown();
    select().selectOptionByValue('');
    expect(chosen).toEqual([thing('a'), undefined]);
    expect(triggerText()).toBe('Nothing chosen');
  });

  it('a fixed first choice with nothing read → "No {things}" at the list\'s end', async () => {
    read.mockResolvedValueOnce({ items: [] });
    open({ fixed: 'Nothing chosen' });
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('No things');
    });
    expect(shown()).toEqual(['Nothing chosen']);
  });

  it('a choice made stays shown as chosen after the text or the list changes', async () => {
    read.mockImplementation((typed) =>
      Promise.resolve(
        typed === '' ? { items: [thing('a', 'alpha'), thing('b', 'beta')] } : { items: [thing('c', 'gamma')] },
      ),
    );
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha', 'beta']);
    });
    select().selectOptionByValue('b');
    select().openDropdown();
    select().findFilteringInput()?.setInputValue('ga');
    await waitFor(() => {
      expect(shown()).toEqual(['gamma']);
    });
    expect(triggerText()).toContain('beta');
  });

  it("without a trigger variant → the closed field shows the chosen option's label alone, as before", async () => {
    read.mockResolvedValueOnce({ items: [thing('t-1', 'alpha', '2', 'the first')] });
    open();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha']);
    });
    select().selectOptionByValue('t-1');
    expect(triggerText()).toBe('alpha');
  });

  it('with the trigger variant "option" → the closed field shows the chosen option\'s label, its description and its tags', async () => {
    read.mockResolvedValueOnce({ items: [thing('t-1', 'alpha', '2', 'the first')] });
    open({ triggerVariant: 'option' });
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha']);
    });
    select().selectOptionByValue('t-1');
    expect(triggerText()).toContain('alpha');
    expect(triggerText()).toContain('the first');
    expect(triggerText()).toContain('t-1');
    expect(triggerText()).toContain('size 2');
  });
});

describe('described and dependent choices', () => {
  it.each([
    ["The emulator's default", '18.3, the version the emulator creates when none is sent.'],
    ['Chosen by the emulator', 'The emulator puts the cluster in its subnet group named default.'],
    ['Default VPC', 'The emulator creates the group in its default VPC, vpc-0123456789abcdef0.'],
  ])('wraps the selected %s description and retains it in the open list', async (fixed, description) => {
    read.mockResolvedValue({ items: [thing('a')] });
    open({ fixed, fixedDescription: description });
    expect(triggerText()).toContain(fixed);
    const help = screen.getByText(description);
    expect(select().findTrigger().getElement()).toContainElement(help);
    expect(help).toHaveStyle({ whiteSpace: 'normal', overflowWrap: 'anywhere' });

    select().openDropdown();
    await waitFor(() => expectOptions({ '': fixed, a: 'a' }));
    const fixedOption = select().findDropdown().findOptionByValue('');
    expect(fixedOption?.findDescription()?.getElement()).toHaveTextContent(description);
    select().selectOptionByValue('a');
    expect(triggerText()).not.toContain(description);
  });

  it('shows a disabled option and its reason and does not choose it', async () => {
    read.mockResolvedValue({ items: [{ ...thing('a'), disabledReason: 'Already used' }] });
    open();
    select().openDropdown();
    await waitFor(() => {
      const option = select().findDropdown().findOptionByValue('a')?.getElement().closest('[role="option"]');
      expect(option).toHaveAttribute('aria-disabled', 'true');
      expect(option).toHaveAccessibleDescription('Already used');
    });
    select().selectOptionByValue('a');
    expect(chosen).toEqual([]);
  });

  it('is locked until the named parent is chosen', async () => {
    read.mockResolvedValue({ items: [thing('a')] });
    const update = open({ lockedBy: 'VPC', fixed: 'No choice' });
    expect(select().findTrigger().getElement()).toBeDisabled();
    expect(triggerText()).toBe('Choose VPC first');
    select().openDropdown();
    expect(read).not.toHaveBeenCalled();

    update({ lockedBy: undefined });
    select().openDropdown();
    await waitFor(() => expectOptions({ '': 'No choice', a: 'a' }));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'Nothing chosen'])('uses the custom empty words with fixed choice %s', async (fixed) => {
    read.mockResolvedValue({ items: [] });
    open({ fixed, none: 'No security groups in vpc-1' });
    select().openDropdown();
    await waitFor(() => expect(dropdownText()).toContain('No security groups in vpc-1'));
  });

  it('shows the holding status and locks the options while keeping the chosen value', async () => {
    read.mockResolvedValue({ items: [thing('a'), thing('b')] });
    const update = open({ fixed: 'No choice' });
    select().openDropdown();
    await waitFor(() => expectOptions({ '': 'No choice', a: 'a', b: 'b' }));
    select().selectOptionByValue('a');
    update({ held: 'Checking VPC' });
    expect(triggerText()).toBe('a');
    expect(screen.getByRole('status')).toHaveTextContent('Checking VPC');

    select().openDropdown();
    const dropdown = select().findDropdown();
    expect(dropdown.findOptions()).toHaveLength(3);
    for (const value of ['', 'a', 'b']) {
      const option = dropdown.findOptionByValue(value)?.getElement().closest('[role="option"]');
      expect(option).toHaveAttribute('aria-disabled', 'true');
    }
    select().selectOptionByValue('b');
    expect(chosen).toEqual([thing('a')]);

    update({ held: undefined });
    select().selectOptionByValue('b');
    expect(chosen).toEqual([thing('a'), thing('b')]);
  });
});

describe('openings', () => {
  it('reads again after Esc even if the trigger retains focus', async () => {
    read.mockResolvedValueOnce({ items: [thing('a')] }).mockResolvedValueOnce({ items: [thing('b')] });
    open({ readAgainOnOpen: true });
    select().openDropdown();
    await waitFor(() => expectOptions({ a: 'a' }));
    const filter = screen.getByRole('combobox');
    fireEvent.keyDown(filter, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(select().findTrigger().getElement()).toHaveFocus();

    select().openDropdown();
    await waitFor(() => expectOptions({ b: 'b' }));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('focus alone does not read and a later opening sees a change made after focus', async () => {
    read.mockResolvedValue({ items: [thing('a')] });
    open({ readAgainOnOpen: true });
    select().openDropdown();
    await waitFor(() => expectOptions({ a: 'a' }));
    select().closeDropdown();
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      select().findTrigger().focus();
    });
    expect(read).toHaveBeenCalledTimes(1);

    read.mockResolvedValue({ items: [thing('a'), thing('b')] });
    select().openDropdown();
    await waitFor(() => expectOptions({ a: 'a', b: 'b' }));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads an unmarked source once and calls onOpen once per opening', async () => {
    read.mockResolvedValue({ items: [thing('a')] });
    const onOpen = vi.fn();
    open({ onOpen });
    select().openDropdown();
    await waitFor(() => expectOptions({ a: 'a' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    select().closeDropdown();
    select().openDropdown();
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenCalledTimes(1);
  });
});
