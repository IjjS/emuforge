import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { ChoiceMultiselect, type ChoiceMultiselectProps } from './choice-multiselect';
import type { AreaConnection } from './emulator-line';
import type { ChoiceSource } from './use-paged-choices';
import type { TokenPage } from './use-token-listing';

// The multiple field with a stand-in reader and stand-in words: the reader's answers are the case's.

const ENGINE = 'http://127.0.0.1:8397';
const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9397, endpoint: 'https://127.0.0.1:9397' } },
  engineOrigin: ENGINE,
};

interface Thing {
  id: string;
  name: string;
  disabledReason?: string;
}

const thing = (id: string, name = id): Thing => ({ id, name });

type Reader = (text: string, token: string | undefined) => Promise<TokenPage<Thing>>;

let read: ReturnType<typeof vi.fn<Reader>>;
let latest: Thing[];

const SOURCE: ChoiceSource<Thing> = {
  key: ['test', 'things'],
  endpoint: ENGINE,
  operation: 'ListThings',
  filtering: 'sent',
  read: (_endpoint, text, token) => read(text, token),
  optionOf: (each) => ({
    value: each.id,
    label: each.name,
    description: each.id,
    ...(each.disabledReason === undefined ? {} : { disabled: true, disabledReason: each.disabledReason }),
  }),
};

interface FieldOptions extends Pick<ChoiceMultiselectProps<Thing>, 'fixed' | 'fixedDescription' | 'lockedBy' | 'none'> {
  readAgainOnOpen?: boolean;
}

function Field({ readAgainOnOpen, ...options }: FieldOptions) {
  const [value, setValue] = useState<Thing[]>([]);
  return (
    <ChoiceMultiselect<Thing>
      source={{ ...SOURCE, readAgainOnOpen }}
      connection={CONNECTION}
      things="things"
      placeholder="Choose things"
      value={value}
      {...options}
      onChange={(choices) => {
        latest = choices;
        setValue(choices);
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

function field() {
  const found = PAGE.findMultiselect();
  if (found === null) {
    throw new Error('no multiselect');
  }
  return found;
}

function shown(): string[] {
  return (field().findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()));
}

function dropdownText(): string {
  return text(field().findDropdown().getElement());
}

function tokens(): string[] {
  return (field().findTokens() ?? []).map((token) => text(token.findLabel().getElement()));
}

beforeEach(() => {
  read = vi.fn<Reader>();
  latest = [];
});

describe('ChoiceMultiselect', () => {
  it('several choices are made and each can be removed; the placeholder shows with none', async () => {
    read.mockResolvedValue({ items: [thing('a', 'alpha'), thing('b', 'beta'), thing('c', 'gamma')] });
    open();
    expect(text(field().findTrigger().getElement())).toContain('Choose things');
    field().openDropdown();
    await waitFor(() => {
      expect(shown()).toEqual(['alpha', 'beta', 'gamma']);
    });
    field().selectOptionByValue('a');
    field().selectOptionByValue('c');
    expect(latest).toEqual([thing('a', 'alpha'), thing('c', 'gamma')]);
    field().closeDropdown();
    expect(tokens()).toEqual(['alpha', 'gamma']);

    field().findToken(1)?.findDismiss().click();
    expect(latest).toEqual([thing('c', 'gamma')]);
    expect(tokens()).toEqual(['gamma']);
    field().findToken(1)?.findDismiss().click();
    expect(latest).toEqual([]);
    expect(tokens()).toEqual([]);
    expect(text(field().findTrigger().getElement())).toContain('Choose things');
  });

  it('loading, "Load more", a typed text, none, and a failed page with "Retry" as the single field\'s', async () => {
    let answer: (page: TokenPage<Thing>) => void = () => undefined;
    read
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockRejectedValueOnce(new RequestError({ kind: 'other', operation: 'ListThings', code: 'Boom', message: 'no' }))
      .mockResolvedValueOnce({ items: [thing('b')] })
      .mockResolvedValueOnce({ items: [] });
    open();
    expect(read).not.toHaveBeenCalled();
    field().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('Loading things');
    });
    answer({ items: [thing('a')], next: 'tok-1' });
    await waitFor(() => {
      expect(shown()).toEqual(['a']);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdownText()).toContain('The things could not be loaded');
    });
    expect(dropdownText()).toContain('Boom: no');
    expect(shown()).toEqual(['a']);
    field().findErrorRecoveryButton()?.click();
    await waitFor(() => {
      expect(shown()).toEqual(['a', 'b']);
    });
    expect(read).toHaveBeenLastCalledWith('', 'tok-1');

    field().findFilteringInput()?.setInputValue('zz');
    await waitFor(() => {
      expect(dropdownText()).toContain('No things match');
    });
    expect(read).toHaveBeenLastCalledWith('zz', undefined);
  });

  it('an empty first page with no text → "No things"', async () => {
    read.mockResolvedValue({ items: [] });
    open();
    field().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('No things');
    });
    expect(dropdownText()).not.toContain('match');
    expect(read).toHaveBeenCalledWith('', undefined);
  });

  it("a failed page names the operation when not implemented, and the engine's reason when refused", async () => {
    read
      .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'ListThings' }))
      .mockRejectedValueOnce(
        new RequestError({ kind: 'access-denied', operation: 'ListThings', message: 'denied here' }),
      );
    open();
    field().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('501 Not Implemented for ListThings.');
    });
    field().findErrorRecoveryButton()?.click();
    await waitFor(() => {
      expect(dropdownText()).toContain('Access denied. ListThings was refused: denied here');
    });
  });
});

it('is locked until the parent is chosen and then uses the custom empty words', async () => {
  read.mockResolvedValue({ items: [] });
  const update = open({ lockedBy: 'VPC', none: 'No security groups in vpc-1' });
  expect(field().findTrigger().getElement()).toBeDisabled();
  expect(text(field().findTrigger().getElement())).toContain('Choose VPC first');
  field().openDropdown();
  expect(read).not.toHaveBeenCalled();
  update({ lockedBy: undefined });
  field().openDropdown();
  await waitFor(() => expect(dropdownText()).toContain('No security groups in vpc-1'));
  expect(read).toHaveBeenCalledTimes(1);
});

it('shows a disabled option and its reason without choosing it', async () => {
  read.mockResolvedValue({ items: [{ ...thing('a', 'alpha'), disabledReason: 'Already used' }] });
  open();
  field().openDropdown();
  const option = await screen.findByRole('option', { name: /alpha/ });
  expect(option).toHaveAttribute('aria-disabled', 'true');
  expect(option).toHaveAccessibleDescription('Already used');
  field().selectOptionByValue('a');
  expect(latest).toEqual([]);
});

it('wraps the selected fixed description and retains it in the open list', async () => {
  const description = 'The emulator uses its default security group in VPC vpc-0123456789abcdef0.';
  read.mockResolvedValue({ items: [thing('a')] });
  open({ fixed: 'Default security group', fixedDescription: description });
  expect(tokens()).toEqual(['Default security group']);
  expect(screen.getByText(description)).toHaveStyle({ whiteSpace: 'normal', overflowWrap: 'anywhere' });

  field().openDropdown();
  await waitFor(() => expect(shown()).toEqual(['Default security group', 'a']));
  const fixed = field().findDropdown().findOption(1);
  expect(text(fixed?.getElement())).toContain(description);
  field().selectOptionByValue('a');
  expect(latest).toEqual([thing('a')]);
  expect(tokens()).toEqual(['a']);
  expect(screen.getAllByText(description)).toHaveLength(1);

  fixed?.click();
  expect(latest).toEqual([]);
  expect(tokens()).toEqual(['Default security group']);
  expect(screen.getAllByText(description)).toHaveLength(2);
});

it('reads a marked source again on reopen and keeps a chosen token from the earlier list', async () => {
  read.mockResolvedValueOnce({ items: [thing('a')] }).mockResolvedValueOnce({ items: [thing('b')] });
  open({ readAgainOnOpen: true });
  field().openDropdown();
  await waitFor(() => expect(shown()).toEqual(['a']));
  field().selectOptionByValue('a');
  field().closeDropdown();
  await waitFor(() => expect(field().findTrigger().getElement()).toHaveAttribute('aria-expanded', 'false'));
  field().openDropdown();
  await waitFor(() => expect(shown()).toEqual(['b']));
  expect(read).toHaveBeenCalledTimes(2);
  expect(tokens()).toEqual(['a']);
  field().closeDropdown();
  field().findToken(1)?.findDismiss().click();
  expect(tokens()).toEqual([]);
  expect(latest).toEqual([]);
});
