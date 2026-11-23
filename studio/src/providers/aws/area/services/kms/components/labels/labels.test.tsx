import {
  CreateAliasCommand,
  DescribeKeyCommand,
  ListAliasesCommand,
  ListKeysCommand,
  ListResourceTagsCommand,
  UntagResourceCommand,
  UpdateAliasCommand,
} from '@aws-sdk/client-kms';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../../area-root';
import { PageFlashContext, type FlashResult } from '../../../../components/page-flash';
import { Labels } from './labels';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const keyId = 'test-key-1';
const targetId = 'test-key-2';
const alias = 'alias/events';
const endpoint = 'http://127.0.0.1:8308';
const connection = {
  engineOrigin: endpoint,
  result: { kind: 'connected', checkedAt: 0, emulator: { endpoint: 'https://127.0.0.1:9308', port: 9308 } },
} as const;

function open() {
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [flash, setFlash] = useState<FlashResult>();
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={{ show: setFlash, handOver: vi.fn() }}>
          <div ref={root}>
            {flash?.map((item) => (
              <div key={item.type}>{item.content}</div>
            ))}
            <Labels connection={connection} keyId={keyId} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Area />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function aliasPage(name: string, target = keyId) {
  return { Aliases: [{ AliasName: name, TargetKeyId: target }] };
}

function tagPage(name: string, value: string) {
  return { Tags: [{ TagKey: name, TagValue: value }] };
}

function clickButton(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function deferred<T>() {
  let resolve!: (answer: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  send.mockReset();
});

describe('key labels', () => {
  it('shows empty alias and tag lists with actions to add each', async () => {
    send.mockResolvedValue({});
    open();

    expect(await screen.findByText('No aliases')).toBeVisible();
    expect(await screen.findByText('No tags')).toBeVisible();
    clickButton('Create alias');
    const create = within(await screen.findByRole('dialog', { name: 'Create alias' }));
    expect(create.getByRole('textbox', { name: 'Alias name' })).toBeEnabled();
    fireEvent.click(create.getByRole('button', { name: 'Cancel' }));
    clickButton('Add tag');
    const add = within(await screen.findByRole('dialog', { name: 'Add tag' }));
    expect(add.getByRole('textbox', { name: 'Tag name' })).toBeEnabled();
    expect(add.getByRole('textbox', { name: 'Value' })).toBeEnabled();
  });

  it('uses each list’s marker to reach later alias and tag pages for the current key', async () => {
    send.mockImplementation((command: unknown) => {
      if (command instanceof ListAliasesCommand) {
        expect(command.input.KeyId).toBe(keyId);
        return command.input.Marker === 'next-alias'
          ? aliasPage('alias/invoices')
          : { ...aliasPage(alias), Truncated: true, NextMarker: 'next-alias' };
      }
      if (command instanceof ListResourceTagsCommand) {
        expect(command.input.KeyId).toBe(keyId);
        return command.input.Marker === 'next-tag'
          ? tagPage('owner', 'billing team')
          : { ...tagPage('environment', 'development'), Truncated: true, NextMarker: 'next-tag' };
      }
      throw new Error('Unexpected KMS request');
    });
    open();

    expect(await screen.findByText(alias)).toBeVisible();
    expect(await screen.findByText('development')).toBeVisible();
    const aliases = within(screen.getByRole('list', { name: 'Alias pages' }));
    const tags = within(screen.getByRole('list', { name: 'Tag pages' }));
    fireEvent.click(aliases.getByRole('button', { name: 'Next page' }));
    fireEvent.click(tags.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('alias/invoices')).toBeVisible();
    expect(await screen.findByText('billing team')).toBeVisible();
  });

  it('keeps reassignment success when the original key’s alias read finishes before the target list', async () => {
    let moved = false;
    const targetList = deferred<{ Keys: { KeyId: string }[] }>();
    const keys = { Keys: [{ KeyId: keyId }, { KeyId: targetId }] };
    send.mockImplementation((command: unknown) => {
      if (command instanceof ListKeysCommand) return moved ? targetList.promise : keys;
      if (command instanceof DescribeKeyCommand) {
        return { KeyMetadata: { KeyId: command.input.KeyId, KeyManager: 'CUSTOMER' } };
      }
      if (command instanceof ListAliasesCommand) {
        const owner = moved ? targetId : keyId;
        return command.input.KeyId === owner ? aliasPage(alias, owner) : {};
      }
      if (command instanceof UpdateAliasCommand) {
        expect(command.input).toEqual({ AliasName: alias, TargetKeyId: targetId });
        moved = true;
      }
      return {};
    });
    open();

    await screen.findByText(alias);
    clickButton(`Reassign alias ${alias}`);
    const dialog = within(await screen.findByRole('dialog', { name: 'Reassign alias' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Target key' }));
    fireEvent.click(await dialog.findByRole('option', { name: targetId }));
    fireEvent.click(dialog.getByRole('button', { name: 'Reassign alias' }));

    expect(await screen.findByText('No aliases')).toBeVisible();
    expect(screen.getByText('Alias reassigned.')).toBeVisible();
    expect(send.mock.calls.filter(([command]) => command instanceof ListKeysCommand)).toHaveLength(2);
    await act(async () => targetList.resolve(keys));
    expect(screen.getByText('Alias reassigned.')).toBeVisible();
  });

  it('retains a duplicate alias’s input and refusal without overwriting the existing alias', async () => {
    send.mockImplementation((command: unknown) => {
      if (command instanceof ListAliasesCommand) return aliasPage(alias);
      if (command instanceof CreateAliasCommand) {
        expect(command.input).toEqual({ AliasName: alias, TargetKeyId: keyId });
        throw {
          name: 'AlreadyExistsException',
          message: 'This alias already exists.',
          $metadata: { httpStatusCode: 400 },
        };
      }
      return {};
    });
    open();

    await screen.findByText(alias);
    clickButton('Create alias');
    const dialog = within(await screen.findByRole('dialog', { name: 'Create alias' }));
    const name = dialog.getByRole('textbox', { name: 'Alias name' });
    fireEvent.change(name, { target: { value: 'events' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create alias' }));

    expect(await dialog.findByText(/This alias already exists/)).toBeVisible();
    expect(name).toHaveValue('events');
    expect(screen.getByText(alias)).toBeVisible();
    expect(send.mock.calls.filter(([command]) => command instanceof UpdateAliasCommand)).toHaveLength(0);
  });

  it('keeps the selected tag and shows why KMS refused to remove it', async () => {
    send.mockImplementation((command: unknown) => {
      if (command instanceof ListResourceTagsCommand) return tagPage('environment', 'development');
      if (command instanceof UntagResourceCommand) {
        expect(command.input).toEqual({ KeyId: keyId, TagKeys: ['environment'] });
        throw {
          name: 'KMSInvalidStateException',
          message: 'This key is pending deletion.',
          $metadata: { httpStatusCode: 400 },
        };
      }
      return {};
    });
    open();

    await screen.findByText('development');
    clickButton('Remove tag environment');
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove tag' }));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'remove' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Remove tag' }));

    expect(await screen.findByText(/This key is pending deletion/)).toBeVisible();
    expect(screen.getByRole('cell', { name: 'development' })).toBeVisible();
  });
});
