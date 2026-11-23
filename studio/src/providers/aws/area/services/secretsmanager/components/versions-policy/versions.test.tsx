import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  click,
  CURRENT,
  deferredReply,
  delayedRefresh,
  denied,
  NAME,
  OLDER,
  openSecret,
  ORDERS,
  REFUSAL,
  versionRows,
} from './detail-support.test';

const LIST = 'ListSecretVersionIds';
const UPDATE = 'UpdateSecretVersionStage';

afterEach(() => vi.unstubAllGlobals());

async function openVersions() {
  await click('Version history');
}

function versionRow(id: string) {
  return within(screen.getByRole('table', { name: 'Version history' })).getByRole('row', { name: new RegExp(id) });
}

async function selectVersion(id: string) {
  fireEvent.click(await screen.findByRole('radio', { name: `Select version ${id}` }));
}

async function openStageDialog(menuItem: string, title = menuItem) {
  await click('Manage staging labels');
  fireEvent.click(await screen.findByRole('menuitem', { name: menuItem }));
  return within(await screen.findByRole('dialog', { name: title }));
}

async function chooseLabel(dialog: ReturnType<typeof within>, label: string) {
  const user = userEvent.setup();
  await user.click(dialog.getByRole('button', { name: /Choose a staging label/ }));
  await user.click(await screen.findByRole('option', { name: new RegExp(label) }));
}

describe('Secret version history', () => {
  it('reads history on opening, including versions with no staging labels', async () => {
    const { calls } = openSecret();
    await screen.findByRole('heading', { name: NAME, level: 1 });
    expect(calls.mock.calls.some(([operation]) => operation === LIST)).toBe(false);
    await openVersions();
    await screen.findByRole('radio', { name: `Select version ${OLDER}` });
    expect(within(versionRow(OLDER)).getByText('No labels')).toBeVisible();
    expect(calls).toHaveBeenCalledWith(LIST, { SecretId: NAME, IncludeDeprecated: true, MaxResults: 50 });
  });

  it('opens the next token page', async () => {
    const { calls } = openSecret({
      handler: (operation, input) => {
        if (operation === LIST) {
          return input.NextToken === 'next-token'
            ? { body: { Versions: versionRows({ [OLDER]: [] }) } }
            : { body: { Versions: versionRows({ [CURRENT]: ['AWSCURRENT'] }), NextToken: 'next-token' } };
        }
      },
    });
    await openVersions();
    await click('Next version page');
    expect(await screen.findByRole('radio', { name: `Select version ${OLDER}` })).toBeVisible();
    expect(screen.queryByRole('radio', { name: `Select version ${CURRENT}` })).not.toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith(LIST, {
      SecretId: NAME,
      IncludeDeprecated: true,
      MaxResults: 50,
      NextToken: 'next-token',
    });
  });

  it('shows the empty history message after an empty response', async () => {
    openSecret({ handler: (operation) => (operation === LIST ? { body: {} } : undefined) });
    await openVersions();
    expect(await screen.findByText('No versions found for this secret.')).toBeVisible();
  });

  it('shows the denial reason and retries reading history', async () => {
    let attempts = 0;
    const reason = 'Version history is forbidden.';
    openSecret({ handler: (operation) => (operation === LIST && attempts++ === 0 ? denied(reason) : undefined) });
    await openVersions();
    expect(await screen.findByText(`${LIST} was refused: ${reason}`)).toBeVisible();
    expect(screen.queryByText('No versions found for this secret.')).not.toBeInTheDocument();
    await click('Retry');
    expect(await screen.findByRole('radio', { name: `Select version ${OLDER}` })).toBeVisible();
  });

  it('selects a version without reading its secret value', async () => {
    const { calls } = openSecret();
    await openVersions();
    await selectVersion(OLDER);
    expect(screen.getByText('Secret value is hidden.')).toBeVisible();
    expect(calls.mock.calls.some(([operation]) => operation === 'GetSecretValue')).toBe(false);
  });

  it('retrieves only the value of the selected version on request', async () => {
    const { calls } = openSecret({
      handler: (operation, input) =>
        operation === 'GetSecretValue'
          ? { body: { SecretString: input.VersionId === OLDER ? 'older test value' : 'current test value' } }
          : undefined,
    });
    await openVersions();
    await selectVersion(OLDER);
    await click('Retrieve secret value');
    expect(await screen.findByText('older test value')).toBeVisible();
    expect(screen.queryByText('current test value')).not.toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith('GetSecretValue', { SecretId: NAME, VersionId: OLDER });
  });

  it('immediately hides a displayed value when the selection changes', async () => {
    const { calls } = openSecret({
      handler: (operation) =>
        operation === 'GetSecretValue' ? { body: { SecretString: 'shown test value' } } : undefined,
    });
    await openVersions();
    await selectVersion(CURRENT);
    await click('Retrieve secret value');
    expect(await screen.findByText('shown test value')).toBeVisible();
    await selectVersion(OLDER);
    expect(screen.queryByText('shown test value')).not.toBeInTheDocument();
    expect(screen.getByText('Secret value is hidden.')).toBeVisible();
    expect(calls.mock.calls.filter(([operation]) => operation === 'GetSecretValue')).toHaveLength(1);
  });

  it('cancels the previous version request and ignores a late response', async () => {
    const late = deferredReply();
    const requests = vi.fn<(request: Request) => void>();
    openSecret({
      handler: (operation, input, request) => {
        if (operation === 'GetSecretValue' && input.VersionId === CURRENT) {
          requests(request);
          return late.promise;
        }
        if (operation === 'GetSecretValue') return { body: { SecretString: 'selected test value' } };
      },
    });
    await openVersions();
    await selectVersion(CURRENT);
    await click('Retrieve secret value');
    await waitFor(() => expect(requests).toHaveBeenCalledOnce());
    await selectVersion(OLDER);
    expect(requests.mock.calls[0]?.[0].signal.aborted).toBe(true);
    await click('Retrieve secret value');
    expect(await screen.findByText('selected test value')).toBeVisible();
    await act(() => late.resolve({ body: { SecretString: 'late test value' } }));
    expect(screen.queryByText('late test value')).not.toBeInTheDocument();
  });

  it('shows a denied write and reads the same mapping again', async () => {
    const { calls } = openSecret({ handler: (operation) => (operation === UPDATE ? denied() : undefined) });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('Add staging label');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Staging label' }), { target: { value: 'review' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Add staging label' }));
    expect(await dialog.findByText(`${UPDATE} was refused: ${REFUSAL}`)).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Staging label' })).toHaveValue('review');
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await click('Version history');
    await openVersions();
    await waitFor(() => expect(calls.mock.calls.filter(([operation]) => operation === LIST)).toHaveLength(2));
    expect(within(versionRow(OLDER)).getByText('No labels')).toBeVisible();
    expect(within(versionRow(CURRENT)).getByText('AWSCURRENT')).toBeVisible();
  });

  it('disables the staging operation after a 501 while keeping value retrieval available', async () => {
    openSecret({
      handler: (operation) => (operation === UPDATE ? { body: { __type: 'NotImplemented' }, status: 501 } : undefined),
    });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('Add staging label');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Staging label' }), { target: { value: 'review' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Add staging label' }));
    expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Add staging label' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Manage staging labels' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retrieve secret value' })).toBeEnabled();
  });
});

describe.each(ORDERS)('Version refresh with %s', (order) => {
  it('reads the new current version after saving a value and retains the area success result', async () => {
    const stages = { [CURRENT]: ['AWSPREVIOUS'], [OLDER]: [], 'new-current-version': ['AWSCURRENT'] };
    const refresh = delayedRefresh('PutSecretValue', LIST, stages, { body: { Versions: versionRows(stages) } });
    const { calls } = openSecret({ handler: refresh.handler, observe: refresh.operations });
    await openVersions();
    await screen.findByRole('radio', { name: `Select version ${CURRENT}` });
    await click('Edit secret value');
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit secret value' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Secret value' }), { target: { value: 'new test value' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save secret value' }));
    await refresh.complete(order, 'New secret version stored.');
    expect(calls).toHaveBeenCalledWith(
      'PutSecretValue',
      expect.objectContaining({ SecretId: NAME, SecretString: 'new test value' }),
    );
    expect(within(versionRow('new-current-version')).getByText('AWSCURRENT')).toBeVisible();
    expect(within(versionRow(CURRENT)).getByText('AWSPREVIOUS')).toBeVisible();
  });

  it('reads the new label after adding it and retains the area success result', async () => {
    const stages = { [CURRENT]: ['AWSCURRENT'], [OLDER]: ['review'] };
    const refresh = delayedRefresh(UPDATE, LIST, stages, { body: { Versions: versionRows(stages) } });
    const { calls } = openSecret({ handler: refresh.handler, observe: refresh.operations });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('Add staging label');
    fireEvent.change(dialog.getByRole('textbox', { name: 'Staging label' }), { target: { value: 'review' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Add staging label' }));
    await refresh.complete(order, 'Staging label added.');
    expect(within(versionRow(OLDER)).getByText('review')).toBeVisible();
    expect(calls).toHaveBeenCalledWith(UPDATE, { SecretId: NAME, VersionStage: 'review', MoveToVersionId: OLDER });
  });

  it('reads the label on the destination only after a move and retains the area success result', async () => {
    const stages = { [CURRENT]: ['AWSCURRENT'], [OLDER]: ['review'] };
    const refresh = delayedRefresh(UPDATE, LIST, stages, { body: { Versions: versionRows(stages) } });
    const { calls } = openSecret({
      handler: refresh.handler,
      stages: { [CURRENT]: ['AWSCURRENT', 'review'], [OLDER]: [] },
      observe: refresh.operations,
    });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('Move staging label here', 'Move staging label');
    await chooseLabel(dialog, 'review');
    fireEvent.click(dialog.getByRole('button', { name: 'Move staging label' }));
    await refresh.complete(order, 'Staging label moved.');
    expect(within(versionRow(CURRENT)).getByText('AWSCURRENT')).toBeVisible();
    expect(within(versionRow(OLDER)).getByText('review')).toBeVisible();
    expect(calls).toHaveBeenCalledWith(UPDATE, {
      SecretId: NAME,
      VersionStage: 'review',
      MoveToVersionId: OLDER,
      RemoveFromVersionId: CURRENT,
    });
  });

  it('reads the mapping without a removed label and retains the area success result', async () => {
    const stages = { [CURRENT]: ['AWSCURRENT'], [OLDER]: [] };
    const refresh = delayedRefresh(UPDATE, LIST, stages, { body: { Versions: versionRows(stages) } });
    const { calls } = openSecret({
      handler: refresh.handler,
      stages: { [CURRENT]: ['AWSCURRENT'], [OLDER]: ['review'] },
      observe: refresh.operations,
    });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('Remove staging label');
    await chooseLabel(dialog, 'review');
    fireEvent.click(dialog.getByRole('button', { name: 'Remove staging label' }));
    await refresh.complete(order, 'Staging label removed.');
    expect(within(versionRow(OLDER)).getByText('No labels')).toBeVisible();
    expect(calls).toHaveBeenCalledWith(UPDATE, { SecretId: NAME, VersionStage: 'review', RemoveFromVersionId: OLDER });
  });
});
