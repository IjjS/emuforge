import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  BINARY_VALUE,
  chooseBinary,
  click,
  delayedReads,
  denied,
  enter,
  expectList,
  lifecycleTests,
  NAME,
  NEW_KEY,
  notFound,
  openLifecycle,
  ORDERS,
  REFUSED,
  secretMetadata,
  STRING_VALUE,
} from '../components/lifecycle/lifecycle-test-fixture';
import { SECRET_CREATE_PATH, secretPath } from '../paths';

lifecycleTests();

function openCreate(handler?: Parameters<typeof openLifecycle>[0]) {
  return openLifecycle({ path: SECRET_CREATE_PATH, ...handler });
}

function fill() {
  enter('Secret name', NAME);
  enter('Secret value', STRING_VALUE);
}

function expectNoSuccess() {
  expect(screen.queryByText(`Secret ${NAME} was stored.`)).not.toBeInTheDocument();
}

describe('Store a secret', () => {
  it('returns to secrets when an untouched form is canceled', async () => {
    const { router, count } = openCreate();
    await click('Cancel');
    await expectList(router);
    expect(count('CreateSecret')).toBe(0);
  });

  it('keeps the edited form when the user chooses Keep editing', async () => {
    const { router } = openCreate();
    fill();
    await click('Cancel');
    await click('Keep editing');
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
    expect(screen.getByRole('textbox', { name: 'Secret name' })).toHaveValue(NAME);
    expect(router.state.location.pathname).toBe(SECRET_CREATE_PATH);
  });

  it('discards the form and returns to secrets without creating anything', async () => {
    const { router, count } = openCreate();
    fill();
    await click('Cancel');
    await click('Discard');
    await expectList(router);
    expect(count('CreateSecret')).toBe(0);
  });

  it('sends the exact string, name and optional metadata in one create request', async () => {
    const { calls, count } = openCreate();
    fill();
    enter('Description', 'Development credentials');
    enter('KMS key ARN', NEW_KEY);
    await click('Add tag');
    enter('Key', 'project');
    enter('Value', 'local');
    await click('Store a secret');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('CreateSecret', {
        Name: NAME,
        Description: 'Development credentials',
        KmsKeyId: NEW_KEY,
        Tags: [{ Key: 'project', Value: 'local' }],
        SecretString: STRING_VALUE,
      }),
    );
    expect(count('CreateSecret')).toBe(1);
  });

  it('stores the original file bytes through the binary field only', async () => {
    const { calls } = openCreate();
    enter('Secret name', NAME);
    chooseBinary(screen.getByRole('button', { name: 'Store a secret' }).closest('form')!);
    await click('Store a secret');
    await waitFor(() => expect(calls).toHaveBeenCalledWith('CreateSecret', { Name: NAME, SecretBinary: BINARY_VALUE }));
  });

  it('generates a password only on request and fills the string field', async () => {
    const generated = 'synthetic-generated-value';
    const { count } = openCreate({
      handler: (operation) => (operation === 'GetRandomPassword' ? { body: { RandomPassword: generated } } : undefined),
    });
    fill();
    expect(count('GetRandomPassword')).toBe(0);
    await click('Generate password');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(generated));
    expect(count('GetRandomPassword')).toBe(1);
    expect(count('CreateSecret')).toBe(0);
  });

  it('preserves form inputs and shows the refusal when create fails', async () => {
    const { router } = openCreate({
      handler: (operation) =>
        operation === 'CreateSecret'
          ? {
              body: { __type: 'ResourceExistsException', message: 'A secret with this name already exists.' },
              status: 400,
            }
          : undefined,
    });
    fill();
    await click('Store a secret');
    expect(await screen.findByText('A secret with this name already exists.', { exact: false })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Secret name' })).toHaveValue(NAME);
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
    expect(router.state.location.pathname).toBe(SECRET_CREATE_PATH);
    expectNoSuccess();
  });

  it('preserves the existing string and shows the refusal when generation fails', async () => {
    openCreate({ handler: (operation) => (operation === 'GetRandomPassword' ? denied() : undefined) });
    fill();
    await click('Generate password');
    expect(await screen.findByText(REFUSED, { exact: false })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Secret value' })).toHaveValue(STRING_VALUE);
    expectNoSuccess();
  });

  it.each(ORDERS)('opens the stored secret and keeps the area result when %s', async (order) => {
    const stored = secretMetadata({ Description: 'Stored by Studio' });
    const reads = delayedReads(
      'CreateSecret',
      { body: stored },
      { body: { SecretList: [{ Name: NAME }] } },
      (operation) => (operation === 'DescribeSecret' ? notFound() : { body: { SecretList: [] } }),
    );
    const { router, count } = openCreate({ observe: true, handler: reads.handler });
    await waitFor(() => expect(screen.getByLabelText('Detail read')).toHaveTextContent('ResourceNotFoundException'));
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    fill();
    await click('Store a secret');
    await screen.findByRole('heading', { name: NAME, level: 1 });
    const assertResult = () => {
      expect(within(screen.getByRole('main')).getByText(`Secret ${NAME} was stored.`)).toBeVisible();
    };
    await reads.complete(order, assertResult);
    expect(await screen.findByText('Stored by Studio')).toBeVisible();
    expect(router.state.location.pathname + router.state.location.search).toBe(secretPath(NAME));
    expect(screen.getByLabelText('List read')).toHaveTextContent(NAME);
    expect(count('GetSecretValue')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(count('DescribeSecret')).toBeGreaterThan(2));
    assertResult();
  });
});
