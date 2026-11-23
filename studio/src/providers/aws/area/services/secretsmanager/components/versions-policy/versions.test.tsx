import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CURRENT,
  deferredReply,
  delayedRefresh,
  denied,
  dialogButton,
  dialogContent,
  expectAlert,
  findButton,
  findDialog,
  findSection,
  NAME,
  OLDER,
  openSecret,
  ORDERS,
  page,
  press,
  REFUSAL,
  refusalReread,
  required,
  section,
  sectionContentButton,
  versionRows,
} from './detail-support.test';

const LIST = 'ListSecretVersionIds';
const UPDATE = 'UpdateSecretVersionStage';

afterEach(() => vi.unstubAllGlobals());

async function openVersions() {
  const wrapper = await section('Version history');
  fireEvent.click(wrapper.findExpandButton().getElement());
}

function historyTable() {
  const history = findSection('Version history');
  return history === undefined ? null : createWrapper(history.getElement()).findTable();
}

function versionIndex(id: string) {
  const table = historyTable();
  return (
    table?.findRows().findIndex((_, index) => table.findBodyCell(index + 1, 2)?.getElement().textContent === id) ?? -1
  );
}

async function findVersion(id: string) {
  return waitFor(() => {
    const index = versionIndex(id);
    expect(index).toBeGreaterThanOrEqual(0);
    return index + 1;
  });
}

function expectLabels(id: string, labels: string) {
  const cell = historyTable()
    ?.findBodyCell(versionIndex(id) + 1, 3)
    ?.getElement();
  expect(cell).toBeVisible();
  expect(cell?.textContent).toBe(labels);
}

async function selectVersion(id: string) {
  const row = await findVersion(id);
  const control = required(historyTable()?.findRowSelectionArea(row), 'version selection');
  const radio = required(createWrapper(control.getElement()).findRadioButton(), 'version radio');
  fireEvent.click(radio.findNativeInput().getElement());
}

async function versionPagination() {
  const history = await section('Version history');
  return waitFor(() => required(createWrapper(history.getElement()).findPagination(), 'version pagination'));
}

async function secretValueAction(name: string) {
  return waitFor(() => {
    const header = page()
      .findAllContainers()
      .map((container) => {
        const slot = container.findHeader();
        return slot && createWrapper(slot.getElement()).findHeader();
      })
      .find((entry) => entry?.findHeadingText().getElement().textContent === 'Secret value');
    const actions = header?.findActions();
    return required(actions && findButton(createWrapper(actions.getElement()), name), name).getElement();
  });
}

const stageTitles = { add: 'Add staging label', move: 'Move staging label', remove: 'Remove staging label' };

async function stageMenu() {
  const history = await section('Version history');
  return required(createWrapper(history.findHeader().getElement()).findButtonDropdown(), 'Manage staging labels');
}

async function openStageDialog(operation: keyof typeof stageTitles) {
  const dropdown = await stageMenu();
  expect(dropdown.findNativeButton().getElement()).toHaveAccessibleName('Manage staging labels');
  await act(() => dropdown.openDropdown());
  const item = required(dropdown.findItemById(operation, { disabled: false }), operation);
  fireEvent.click(item.getElement());
  return findDialog(stageTitles[operation]);
}

function stageInput(dialog: Awaited<ReturnType<typeof findDialog>>) {
  return required(dialogContent(dialog).findInput(), 'staging label');
}

async function chooseLabel(dialog: Awaited<ReturnType<typeof findDialog>>, label: string) {
  const select = required(dialogContent(dialog).findSelect(), 'label selector');
  await act(() => select.openDropdown());
  await act(() => select.selectOptionByValue(label));
}

describe('Secret version history', () => {
  it('reads history on opening, including versions with no staging labels', async () => {
    const { calls } = openSecret();
    await waitFor(() =>
      expect(
        page()
          .findAllHeaders()
          .some((header) => header.findHeadingText().getElement().textContent === NAME),
      ).toBe(true),
    );
    expect(calls.mock.calls.some(([operation]) => operation === LIST)).toBe(false);
    await openVersions();
    await findVersion(OLDER);
    expectLabels(OLDER, 'No labels');
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
    fireEvent.click((await versionPagination()).findNextPageButton().getElement());
    await findVersion(OLDER);
    expect(versionIndex(CURRENT)).toBe(-1);
    expect(calls).toHaveBeenCalledWith(LIST, {
      SecretId: NAME,
      IncludeDeprecated: true,
      MaxResults: 50,
      NextToken: 'next-token',
    });
  });

  it.each(['stays on pagination', 'moves away', 'moves away and then blurs'] as const)(
    'keeps a later-page 501 accessible when focus %s',
    async (focus) => {
      const late = deferredReply();
      const { calls } = openSecret({
        handler: (operation, input) => {
          if (operation === LIST) {
            return input.NextToken === 'next-token'
              ? late.promise
              : { body: { Versions: versionRows({ [CURRENT]: ['AWSCURRENT'] }), NextToken: 'next-token' } };
          }
        },
      });
      await openVersions();
      const next = (await versionPagination()).findNextPageButton().getElement();
      const elsewhere = await secretValueAction('Retrieve secret value');
      next.focus();
      expect(next).toHaveFocus();
      await userEvent.setup().keyboard('{Enter}');
      await waitFor(() =>
        expect(calls).toHaveBeenCalledWith(LIST, expect.objectContaining({ NextToken: 'next-token' })),
      );

      // Browsers can drop focus when the pending pagination control becomes disabled.
      next.blur();
      if (focus !== 'stays on pagination') elsewhere.focus();
      if (focus === 'moves away and then blurs') elsewhere.blur();
      await act(() => late.resolve({ body: { __type: 'NotImplemented' }, status: 501 }));
      const history = createWrapper((await section('Version history')).getElement());
      await expectAlert(history, `The emulator answered 501 Not Implemented for ${LIST}`);
      const notice = screen.getByRole('region', { name: 'Not implemented by the emulator' });
      expect(notice).toHaveAccessibleDescription(
        `The emulator answered 501 Not Implemented for ${LIST}, so Studio cannot show the version history.`,
      );
      const expectedFocus = {
        'stays on pagination': notice,
        'moves away': elsewhere,
        'moves away and then blurs': document.body,
      };
      expect(expectedFocus[focus]).toHaveFocus();
      const pagination = await versionPagination();
      expect(pagination.getElement()).toBeVisible();
      expect(pagination.isDisabled()).toBe(true);
      expect(pagination.findPreviousPageButton().isDisabled()).toBe(true);
      expect(pagination.findNextPageButton().isDisabled()).toBe(true);
      const retry = required(history.findAlert()?.findActionSlot(), 'unavailable Retry');
      const retryButton = required(createWrapper(retry.getElement()).findButton(), 'Retry');
      expect(retryButton.getElement()).toBeVisible();
      expect(retryButton.isDisabled()).toBe(true);
      fireEvent.click(pagination.findPreviousPageButton().getElement());
      fireEvent.click(retryButton.getElement());
      expect(calls.mock.calls.filter(([operation]) => operation === LIST)).toHaveLength(2);
    },
  );

  it('shows the empty history message after an empty response', async () => {
    openSecret({ handler: (operation) => (operation === LIST ? { body: {} } : undefined) });
    await openVersions();
    await waitFor(() =>
      expect(historyTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No versions found for this secret.'),
    );
  });

  it('shows the denial reason and retries reading history', async () => {
    let attempts = 0;
    const reason = 'Version history is forbidden.';
    openSecret({ handler: (operation) => (operation === LIST && attempts++ === 0 ? denied(reason) : undefined) });
    await openVersions();
    expect(await screen.findByText(`${LIST} was refused: ${reason}`)).toBeVisible();
    expect(screen.queryByText('No versions found for this secret.')).not.toBeInTheDocument();
    fireEvent.click((await sectionContentButton('Version history', 'Retry')).getElement());
    await findVersion(OLDER);
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
    fireEvent.click(await secretValueAction('Retrieve secret value'));
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
    fireEvent.click(await secretValueAction('Retrieve secret value'));
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
    fireEvent.click(await secretValueAction('Retrieve secret value'));
    await waitFor(() => expect(requests).toHaveBeenCalledOnce());
    await selectVersion(OLDER);
    expect(requests.mock.calls[0]?.[0].signal.aborted).toBe(true);
    fireEvent.click(await secretValueAction('Retrieve secret value'));
    expect(await screen.findByText('selected test value')).toBeVisible();
    await act(() => late.resolve({ body: { SecretString: 'late test value' } }));
    expect(screen.queryByText('late test value')).not.toBeInTheDocument();
  });

  it('shows a denied write and reads the same mapping again', async () => {
    const refused = refusalReread(UPDATE, LIST, {
      body: { Versions: versionRows({ [CURRENT]: ['AWSCURRENT'], [OLDER]: [] }) },
    });
    const subject = openSecret({ handler: refused.handler });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('add');
    fireEvent.change(stageInput(dialog).findNativeInput().getElement(), { target: { value: 'review' } });
    press(dialog, 'Add staging label');
    await expectAlert(dialogContent(dialog), `${UPDATE} was refused: ${REFUSAL}`);
    expect(stageInput(dialog).getInputValue()).toBe('review');
    press(dialog, 'Cancel');
    await openVersions();
    await openVersions();
    await refused.complete(subject);
    expectLabels(OLDER, 'No labels');
    expectLabels(CURRENT, 'AWSCURRENT');
  });

  it('disables the staging operation after a 501 while keeping value retrieval available', async () => {
    openSecret({
      handler: (operation) => (operation === UPDATE ? { body: { __type: 'NotImplemented' }, status: 501 } : undefined),
    });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('add');
    fireEvent.change(stageInput(dialog).findNativeInput().getElement(), { target: { value: 'review' } });
    press(dialog, 'Add staging label');
    await expectAlert(dialogContent(dialog), `The emulator answered 501 Not Implemented for ${UPDATE}.`);
    expect(dialogButton(dialog, 'Add staging label').isDisabled()).toBe(true);
    press(dialog, 'Cancel');
    expect((await stageMenu()).findNativeButton().getElement()).toBeDisabled();
    expect(await secretValueAction('Retrieve secret value')).toBeEnabled();
  });
});

describe.each(ORDERS)('Version refresh with %s', (order) => {
  it('reads the new current version after saving a value and retains the area success result', async () => {
    const stages = { [CURRENT]: ['AWSPREVIOUS'], [OLDER]: [], 'new-current-version': ['AWSCURRENT'] };
    const refresh = delayedRefresh('PutSecretValue', LIST, stages, { body: { Versions: versionRows(stages) } });
    const { calls } = openSecret({ handler: refresh.handler, observe: refresh.operations });
    await openVersions();
    await findVersion(CURRENT);
    fireEvent.click(await secretValueAction('Store new version'));
    const dialog = await findDialog('Store new version');
    const value = required(dialogContent(dialog).findTextarea(), 'secret value');
    fireEvent.change(value.findNativeTextarea().getElement(), { target: { value: 'new test value' } });
    press(dialog, 'Store new version');
    await refresh.complete(order, 'New secret version stored.');
    expect(calls).toHaveBeenCalledWith(
      'PutSecretValue',
      expect.objectContaining({ SecretId: NAME, SecretString: 'new test value' }),
    );
    expectLabels('new-current-version', 'AWSCURRENT');
    expectLabels(CURRENT, 'AWSPREVIOUS');
  });

  it('reads the new label after adding it and retains the area success result', async () => {
    const stages = { [CURRENT]: ['AWSCURRENT'], [OLDER]: ['review'] };
    const refresh = delayedRefresh(UPDATE, LIST, stages, { body: { Versions: versionRows(stages) } });
    const { calls } = openSecret({ handler: refresh.handler, observe: refresh.operations });
    await openVersions();
    await selectVersion(OLDER);
    const dialog = await openStageDialog('add');
    fireEvent.change(stageInput(dialog).findNativeInput().getElement(), { target: { value: 'review' } });
    press(dialog, 'Add staging label');
    await refresh.complete(order, 'Staging label added.');
    expectLabels(OLDER, 'review');
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
    const dialog = await openStageDialog('move');
    await chooseLabel(dialog, 'review');
    press(dialog, 'Move staging label');
    await refresh.complete(order, 'Staging label moved.');
    expectLabels(CURRENT, 'AWSCURRENT');
    expectLabels(OLDER, 'review');
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
    const dialog = await openStageDialog('remove');
    await chooseLabel(dialog, 'review');
    press(dialog, 'Remove staging label');
    await refresh.complete(order, 'Staging label removed.');
    expectLabels(OLDER, 'No labels');
    expect(calls).toHaveBeenCalledWith(UPDATE, { SecretId: NAME, VersionStage: 'review', RemoveFromVersionId: OLDER });
  });
});
