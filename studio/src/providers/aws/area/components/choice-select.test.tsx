import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { ChoiceSelect } from './choice-select';
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
    }),
  };
}

interface FieldOptions {
  filtering: ChoiceFiltering | undefined;
  fixed: string | undefined;
  triggerVariant: 'label' | 'option' | undefined;
}

function Field({ filtering, fixed, triggerVariant }: FieldOptions) {
  const [value, setValue] = useState<Thing>();
  return (
    <ChoiceSelect<Thing>
      source={source(filtering)}
      connection={CONNECTION}
      things="things"
      placeholder="Choose a thing"
      fixed={fixed}
      triggerVariant={triggerVariant}
      value={value}
      onChange={(choice) => {
        chosen.push(choice);
        setValue(choice);
      }}
    />
  );
}

function open({
  filtering = 'sent',
  fixed,
  triggerVariant,
}: { filtering?: ChoiceFiltering; fixed?: string; triggerVariant?: 'label' | 'option' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Field filtering={filtering} fixed={fixed} triggerVariant={triggerVariant} />
    </QueryClientProvider>,
  );
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

function dropdownText(): string {
  return text(select().findDropdown().getElement());
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

    expect(select().findDropdown().findOptionByValue(twoSpaces.id)?.findLabel().getElement()).toHaveTextContent(
      identity,
    );
    expect(select().findDropdown().findOptionByValue(oneSpace.id)?.findLabel().getElement()).toHaveTextContent('a b');
    select().selectOptionByValue(twoSpaces.id);
    expect(triggerText()).toBe(identity);
    expect(chosen).toEqual([twoSpaces]);
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
    await waitFor(() => expect(dropdownText()).toBe('No things match'));
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
    await waitFor(() => expect(dropdownText()).toContain('Loading things'));

    reject(new RequestError({ kind: 'other', code: 'Broken' }));
    await waitFor(() => expect(dropdownText()).toContain('The things could not be loaded: Broken'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(dropdownText()).toBe('No things'));
  });

  it('filters a fixed first choice even when the source is empty, restoring it when the text is cleared', async () => {
    read.mockResolvedValue({ items: [] });
    open({ filtering: 'local', fixed: 'No key pair' });
    select().openDropdown();
    await waitFor(() => expect(dropdownText()).toContain('No things'));

    const input = select().findFilteringInput();
    input?.setInputValue('missing');
    await waitFor(() => expect(dropdownText()).toBe('No things match'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
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
    const first = select().findDropdown().findOption(1);
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
    select().selectOption(1);
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
