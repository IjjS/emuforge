import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, requestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as instanceApi from '../api';
import { listGroupChoices, listInstanceTypeChoices } from '../choices-api';
import { MODIFY_INSTANCE_ATTRIBUTE, modifyInstanceAttribute } from '../instance-attribute-api';
import { EC2_KEYS } from '../queries';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  getInstance: vi.fn(),
  getTerminationProtection: vi.fn(),
}));

vi.mock('../choices-api', async (original) => ({
  ...(await original<typeof import('../choices-api')>()),
  listGroupChoices: vi.fn(),
  listInstanceTypeChoices: vi.fn(),
}));

vi.mock('../instance-attribute-api', async (original) => ({
  ...(await original<typeof import('../instance-attribute-api')>()),
  modifyInstanceAttribute: vi.fn(),
}));

const ENDPOINT = 'http://127.0.0.1:8397';
const CONNECTION: AreaConnection = {
  engineOrigin: ENDPOINT,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9397, endpoint: 'https://127.0.0.1:9397' } },
};
const ALPHA = { id: 'sg-a', name: 'alpha' };
const CHARLIE = { id: 'sg-c', name: 'charlie' };
const CORE: instanceApi.Instance = {
  id: 'i-561',
  state: 'stopped',
  type: 't3.micro',
  volumes: [],
  tags: [],
  groups: [ALPHA, CHARLIE],
};
const TYPE = 'Change instance type';
const GROUPS = 'Change security groups';
const PROTECTION = 'Change termination protection';
const LARGE = { type: 't3.large', architectures: [] };
const BETA = { id: 'sg-b', name: 'beta' };
const PAGE = createWrapper(document.body);

function renderEditor(instance = { ...CORE, vpcId: 'vpc-1' } as instanceApi.Instance) {
  vi.mocked(instanceApi.getInstance).mockResolvedValue({ found: true, instance });
  const client = new QueryClient();
  const tree = (connection: AreaConnection, targetGeneration: number) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/aws/ec2/instances/instance/i-561']}>
        <AwsArea
          connection={connection}
          routeChanges={0}
          targetGeneration={targetGeneration}
          headerSelector="#top-bar"
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(CONNECTION, 0));
  return { client, switchTarget: (connection: AreaConnection) => rerender(tree(connection, 1)) };
}

function sdkRefusal(operation: string, code: string, message: string, status: number) {
  return new RequestError(
    requestFailure(operation, { Code: code, message, $fault: 'client', $metadata: { httpStatusCode: status } }),
  );
}

function isDisabled(button: HTMLElement) {
  return (button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true';
}

async function edit(label: string) {
  const action = await screen.findByRole('button', { name: label });
  await waitFor(() => expect(isDisabled(action)).toBe(false));
  fireEvent.click(action);
  return waitFor(() => {
    const modal = PAGE.findModal();
    if (modal === null) throw new Error('Missing instance attribute modal');
    expect(modal.findHeader().getElement()).toHaveTextContent(label);
    return modal;
  });
}

function saveButton(modal: Awaited<ReturnType<typeof edit>>) {
  const button = modal.findFooter()?.findAllButtons()[1]?.getElement();
  if (button === undefined) throw new Error('Missing instance attribute save button');
  expect(button).toHaveAccessibleName('Save changes');
  return button;
}

function pairValue(label: string) {
  return PAGE.findAllKeyValuePairs()
    .flatMap((pairs) => pairs.findItems())
    .find((item) => item.findLabel()?.getElement().textContent === label)
    ?.findValue();
}

function typeField() {
  const field = PAGE.findSelect();
  if (field === null || field === undefined) throw new Error('Missing instance type selector');
  return field;
}

function groupField() {
  const field = PAGE.findMultiselect();
  if (field === null || field === undefined) throw new Error('Missing security group selector');
  return field;
}

async function loadMore(field: ReturnType<typeof typeField> | ReturnType<typeof groupField>) {
  const more = await waitFor(() => {
    const button = field.findDropdownFooter()?.findButton();
    if (button === undefined || button === null) throw new Error('Missing dropdown pagination button');
    expect(button.getElement()).toHaveAccessibleName('Load more');
    return button;
  });
  more.click();
}

function tokens() {
  return groupField()
    .findTokens()
    .map((token) => token.findLabel().getElement().textContent);
}

async function selectLarge() {
  typeField().openDropdown();
  await waitFor(() => expect(typeField().findDropdown().findOptionByValue(LARGE.type)).not.toBeNull());
  typeField().selectOptionByValue(LARGE.type);
}

async function selectBeta() {
  groupField().openDropdown();
  await waitFor(() => expect(groupField().findDropdown().findOptionByValue(BETA.id)).not.toBeNull());
  groupField().selectOptionByValue(BETA.id);
  groupField().closeDropdown();
}

async function enterDraft(label: string) {
  const dialog = await edit(label);
  if (label === TYPE) await selectLarge();
  else if (label === GROUPS) await selectBeta();
  else dialog.findContent().findToggle()?.findNativeInput().click();
  expect(isDisabled(saveButton(dialog))).toBe(false);
  return dialog;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      media,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.mocked(instanceApi.getTerminationProtection).mockResolvedValue(false);
  vi.mocked(listInstanceTypeChoices).mockResolvedValue({ choices: [LARGE] });
  vi.mocked(listGroupChoices).mockResolvedValue({ choices: [BETA] });
});

afterEach(() => vi.unstubAllGlobals());

describe('instance attribute editor', () => {
  it('selects a type from the next page and cancels without writing', async () => {
    vi.mocked(listInstanceTypeChoices)
      .mockResolvedValueOnce({ choices: [{ type: 't3.micro', architectures: [] }], nextToken: 'next-type' })
      .mockResolvedValueOnce({ choices: [LARGE] });
    renderEditor();
    const dialog = await edit(TYPE);
    expect(dialog.findContent().findFormField()?.findDescription()?.getElement()).toHaveTextContent('t3.micro');
    typeField().openDropdown();
    await loadMore(typeField());
    await waitFor(() => expect(typeField().findDropdown().findOptionByValue(LARGE.type)).not.toBeNull());
    expect(listInstanceTypeChoices).toHaveBeenLastCalledWith(ENDPOINT, '', 'next-type', expect.any(AbortSignal));
    typeField().selectOptionByValue(LARGE.type);
    expect(isDisabled(saveButton(dialog))).toBe(false);
    const cancel = dialog.findFooter()?.findAllButtons()[0];
    expect(cancel?.getElement()).toHaveAccessibleName('Cancel');
    cancel?.click();
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    expect(pairValue('Type')?.getElement()).toHaveTextContent('t3.micro');
    expect(modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('blocks an open type editor when a newer read says the instance is starting', async () => {
    const { client } = renderEditor();
    const dialog = await enterDraft(TYPE);
    vi.mocked(instanceApi.getInstance).mockResolvedValue({ found: true, instance: { ...CORE, state: 'pending' } });
    await act(() => client.invalidateQueries({ queryKey: EC2_KEYS.instance(CORE.id) }));
    await waitFor(() => expect(isDisabled(saveButton(dialog))).toBe(true));
    expect(dialog.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(
      'Stop the instance to change its type.',
    );
    expect(typeField().findTrigger().getElement()).toHaveTextContent(LARGE.type);
    fireEvent.click(saveButton(dialog));
    expect(modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it('cancels a pending type save when the area changes targets', async () => {
    let finishWrite: () => void = () => undefined;
    vi.mocked(modifyInstanceAttribute).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const { switchTarget } = renderEditor();
    const dialog = await enterDraft(TYPE);
    fireEvent.click(saveButton(dialog));
    const signal = vi.mocked(modifyInstanceAttribute).mock.lastCall?.[3];
    expect(signal?.aborted).toBe(false);

    switchTarget({
      engineOrigin: ENDPOINT,
      result: {
        kind: 'connected',
        checkedAt: 1,
        target: 'next-target',
        emulator: { port: 9397, endpoint: 'https://127.0.0.1:9397' },
      },
    });
    expect(signal?.aborted).toBe(true);
    await act(() => finishWrite());
    expect(PAGE.findModal()).toBeNull();
    expect(PAGE.findFlashbar()?.findItemsByType('success') ?? []).toHaveLength(0);
  });

  it('shows current groups from different pages, requires at least one, and keeps the draft while paging', async () => {
    vi.mocked(listGroupChoices)
      .mockResolvedValueOnce({ choices: [ALPHA, BETA], nextToken: 'next-group' })
      .mockResolvedValueOnce({ choices: [CHARLIE] });
    renderEditor();
    const dialog = await edit(GROUPS);
    expect(tokens()).toEqual(['alpha', 'charlie']);
    groupField().findToken(1)?.findDismiss().click();
    groupField().findToken(1)?.findDismiss().click();
    expect(tokens()).toEqual([]);
    expect(isDisabled(saveButton(dialog))).toBe(true);
    await selectBeta();
    groupField().openDropdown();
    await loadMore(groupField());
    await waitFor(() => expect(groupField().findDropdown().findOptionByValue('sg-c')).not.toBeNull());
    expect(listGroupChoices).toHaveBeenLastCalledWith(
      ENDPOINT,
      { vpcId: 'vpc-1' },
      'next-group',
      expect.any(AbortSignal),
    );
    expect(tokens()).toEqual(['beta']);
    groupField().selectOptionByValue('sg-c');
    expect(tokens()).toEqual(['beta', 'charlie']);
  });

  it('shows the chosen security group identity and saves the group ID', async () => {
    const group = { id: 'sg-b', name: 'dev  group' };
    const identity = 'dev\\u0020\\u0020group';
    vi.mocked(listGroupChoices).mockResolvedValue({ choices: [group] });
    vi.mocked(modifyInstanceAttribute).mockResolvedValue(undefined);
    renderEditor({ ...CORE, vpcId: 'vpc-1', groups: [] });

    const dialog = await edit(GROUPS);
    await selectBeta();
    expect(tokens()).toEqual([identity]);
    expect(groupField().findToken(1)?.findDismiss()?.getElement()).toHaveAccessibleName(`Remove ${identity}`);

    fireEvent.click(saveButton(dialog));
    await waitFor(() =>
      expect(modifyInstanceAttribute).toHaveBeenCalledWith(
        ENDPOINT,
        CORE.id,
        { kind: 'groups', groupIds: [group.id] },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
  });

  it('offers only the instance VPC groups when the candidate source holds groups for different VPCs', async () => {
    const choices = [
      { vpcId: 'vpc-1', group: BETA },
      { vpcId: 'vpc-2', group: { id: 'sg-x', name: 'external' } },
    ];
    vi.mocked(listGroupChoices).mockImplementation(async (_endpoint, { vpcId }) => ({
      choices: choices.filter((choice) => vpcId === undefined || choice.vpcId === vpcId).map(({ group }) => group),
    }));
    renderEditor();
    await edit(GROUPS);
    groupField().openDropdown();
    await waitFor(() => expect(groupField().findDropdown().findOptionByValue(BETA.id)).not.toBeNull());
    expect(groupField().findDropdown().findOptionByValue('sg-x')).toBeNull();
    expect(listGroupChoices).toHaveBeenCalledWith(ENDPOINT, { vpcId: 'vpc-1' }, undefined, expect.any(AbortSignal));
  });

  it('leaves the group action unavailable if the instance has no VPC and requests no candidates', async () => {
    renderEditor(CORE);
    const action = await screen.findByRole('button', { name: GROUPS });
    expect(isDisabled(action)).toBe(true);
    fireEvent.click(action);
    expect(PAGE.findModal()).toBeNull();
    expect(listGroupChoices).not.toHaveBeenCalled();
  });

  it('reports candidate load failure and recovers real options on Retry', async () => {
    vi.mocked(listInstanceTypeChoices).mockRejectedValueOnce(
      sdkRefusal('DescribeInstanceTypes', 'InternalError', 'Could not load the instance types', 500),
    );
    renderEditor();
    const dialog = await edit(TYPE);
    typeField().openDropdown();
    await waitFor(() => {
      expect(typeField().findStatusIndicator()?.getElement()).toHaveTextContent(
        'InternalError: Could not load the instance types',
      );
    });
    expect(isDisabled(saveButton(dialog))).toBe(true);
    expect(modifyInstanceAttribute).not.toHaveBeenCalled();
    typeField().findErrorRecoveryButton()?.click();
    await waitFor(() => expect(typeField().findDropdown().findOptionByValue(LARGE.type)).not.toBeNull());
    typeField().selectOptionByValue(LARGE.type);
    expect(isDisabled(saveButton(dialog))).toBe(false);
  });

  it.each([
    { label: TYPE, code: 'IncorrectInstanceState', message: 'The instance started while the editor was open.' },
    { label: GROUPS, code: 'InvalidGroup.NotFound', message: 'The selected group was deleted.' },
    { label: PROTECTION, code: 'AccessDeniedException', message: 'This instance is protected by the local policy.' },
  ])('reports $code in the dialog and area flash while keeping the draft', async ({ label, code, message }) => {
    renderEditor();
    const dialog = await enterDraft(label);
    vi.mocked(modifyInstanceAttribute).mockRejectedValueOnce(
      sdkRefusal(MODIFY_INSTANCE_ATTRIBUTE, code, message, label === PROTECTION ? 403 : 400),
    );
    fireEvent.click(saveButton(dialog));
    const alert = await within(dialog.findContent().getElement()).findByRole('alert');
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(`${code}: ${message}`);
    const flash = PAGE.findFlashbar();
    const refusal = flash?.findItemsByType('error')[0];
    expect(refusal?.findContent()?.getElement()).toHaveTextContent(`${code}: ${message}`);
    expect(refusal?.getElement()).not.toHaveAttribute('role', 'alert');
    expect(flash?.findItemsByType('success')).toHaveLength(0);
    expect(isDisabled(saveButton(dialog))).toBe(false);
    if (label === PROTECTION) expect(pairValue('Termination protection')?.getElement()).toHaveTextContent(/^Off/);

    const originalDraft = vi.mocked(modifyInstanceAttribute).mock.lastCall?.[2];
    if (label === GROUPS) {
      expect(tokens()).toEqual(['alpha', 'charlie', 'beta']);
      const removeBeta = groupField().findToken(3)?.findDismiss();
      expect(removeBeta?.getElement()).toHaveAccessibleName('Remove beta');
      removeBeta?.click();
      const removeAlpha = groupField().findToken(1)?.findDismiss();
      expect(removeAlpha?.getElement()).toHaveAccessibleName('Remove alpha');
      removeAlpha?.click();
    }
    vi.mocked(modifyInstanceAttribute).mockResolvedValueOnce(undefined);
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
    expect(modifyInstanceAttribute).toHaveBeenCalledTimes(2);
    expect(modifyInstanceAttribute).toHaveBeenLastCalledWith(
      ENDPOINT,
      CORE.id,
      label === GROUPS ? { kind: 'groups', groupIds: [CHARLIE.id] } : originalDraft,
      expect.any(AbortSignal),
    );
  });

  it.each([
    { label: TYPE, operation: 'DescribeInstanceTypes' },
    { label: GROUPS, operation: 'DescribeSecurityGroups' },
    { label: PROTECTION, operation: 'DescribeInstanceAttribute' },
  ])('leaves $label unavailable when $operation returns 501', async ({ label, operation }) => {
    const refused = sdkRefusal(operation, 'NotImplemented', 'Unavailable in this emulator build.', 501);
    if (label === TYPE) vi.mocked(listInstanceTypeChoices).mockRejectedValueOnce(refused);
    if (label === GROUPS) vi.mocked(listGroupChoices).mockRejectedValueOnce(refused);
    if (label === PROTECTION) vi.mocked(instanceApi.getTerminationProtection).mockRejectedValueOnce(refused);
    renderEditor();
    if (label !== PROTECTION) {
      await edit(label);
      if (label === TYPE) typeField().openDropdown();
      else groupField().openDropdown();
    }
    const action = await screen.findByRole('button', { name: label });
    const result =
      label === PROTECTION
        ? pairValue('Termination protection')
        : PAGE.findAll('[data-testid="instance-attribute-action"]').find((wrapper) =>
            wrapper.getElement().contains(action),
          );
    await waitFor(() => {
      expect(result?.findStatusIndicator()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(result?.getElement()).toHaveTextContent(`501 Not Implemented for ${operation}`);
      expect(result?.getElement()).toHaveTextContent('Unavailable in this emulator build.');
      expect(isDisabled(action)).toBe(true);
    });
    expect(PAGE.findModal()).toBeNull();
    expect(modifyInstanceAttribute).not.toHaveBeenCalled();
  });

  it.each([TYPE, GROUPS, PROTECTION])(
    'leaves %s unavailable when ModifyInstanceAttribute returns 501',
    async (label) => {
      renderEditor();
      const dialog = await enterDraft(label);
      vi.mocked(modifyInstanceAttribute).mockRejectedValueOnce(
        sdkRefusal(MODIFY_INSTANCE_ATTRIBUTE, 'NotImplemented', 'This attribute cannot be changed here.', 501),
      );
      fireEvent.click(saveButton(dialog));
      await waitFor(() => {
        const item = PAGE.findFlashbar()?.findItemsByType('info')[0];
        expect(item?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
        expect(item?.findContent()?.getElement()).toHaveTextContent('501 Not Implemented for ModifyInstanceAttribute');
        expect(item?.findContent()?.getElement()).toHaveTextContent('This attribute cannot be changed here.');
      });
      expect(isDisabled(screen.getByRole('button', { name: label }))).toBe(true);
      expect(PAGE.findModal()).toBeNull();
    },
  );
});
