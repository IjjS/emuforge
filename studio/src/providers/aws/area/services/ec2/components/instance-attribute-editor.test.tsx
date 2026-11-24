import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, requestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as instanceApi from '../api';
import { listGroupChoices, listInstanceTypeChoices } from '../choices-api';
import { MODIFY_INSTANCE_ATTRIBUTE, modifyInstanceAttribute } from '../instance-attribute-api';

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
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/aws/ec2/instances/instance/i-561']}>
        <AwsArea
          connection={CONNECTION}
          routeChanges={0}
          headerSelector="#top-bar"
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  return screen.findByRole('dialog', { name: label });
}

function saveButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: 'Save changes' });
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
  else PAGE.findToggle()?.findNativeInput().click();
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
    expect(within(dialog).getByText('t3.micro')).toBeVisible();
    typeField().openDropdown();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(typeField().findDropdown().findOptionByValue(LARGE.type)).not.toBeNull());
    expect(listInstanceTypeChoices).toHaveBeenLastCalledWith(ENDPOINT, '', 'next-type', expect.any(AbortSignal));
    typeField().selectOptionByValue(LARGE.type);
    expect(isDisabled(saveButton(dialog))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TYPE })).toBeNull());
    expect(screen.getByText('t3.micro')).toBeVisible();
    expect(modifyInstanceAttribute).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
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
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listGroupChoices).not.toHaveBeenCalled();
  });

  it('reports candidate load failure and recovers real options on Retry', async () => {
    vi.mocked(listInstanceTypeChoices).mockRejectedValueOnce(
      sdkRefusal('DescribeInstanceTypes', 'InternalError', 'Could not load the instance types', 500),
    );
    renderEditor();
    const dialog = await edit(TYPE);
    typeField().openDropdown();
    expect(await screen.findByText(/InternalError: Could not load the instance types/)).toBeVisible();
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
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(`${code}: ${message}`);
    const flash = PAGE.findFlashbar()?.getElement();
    expect(flash).toHaveTextContent(`${code}: ${message}`);
    expect(flash?.querySelector('[role="alert"]')).toBeNull();
    expect(flash).not.toHaveTextContent(/updated\./);
    expect(isDisabled(saveButton(dialog))).toBe(false);
    if (label === PROTECTION) expect(screen.getByText('Off')).toBeVisible();

    const originalDraft = vi.mocked(modifyInstanceAttribute).mock.lastCall?.[2];
    if (label === GROUPS) {
      expect(tokens()).toEqual(['alpha', 'charlie', 'beta']);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove beta' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove alpha' }));
    }
    vi.mocked(modifyInstanceAttribute).mockResolvedValueOnce(undefined);
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: label })).toBeNull());
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
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(new RegExp(`501 Not Implemented for ${operation}`))).toBeVisible();
    expect(screen.getByText('Unavailable in this emulator build.')).toBeVisible();
    expect(isDisabled(screen.getByRole('button', { name: label }))).toBe(true);
    expect(screen.queryByRole('dialog', { name: label })).toBeNull();
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
      const status = await screen.findByText('Not implemented by the emulator');
      expect(PAGE.findFlashbar()?.getElement()).toContainElement(status);
      expect(PAGE.findFlashbar()?.getElement()).toHaveTextContent(/501 Not Implemented for ModifyInstanceAttribute/);
      expect(PAGE.findFlashbar()?.getElement()).toHaveTextContent('This attribute cannot be changed here.');
      expect(isDisabled(screen.getByRole('button', { name: label }))).toBe(true);
      expect(screen.queryByRole('dialog', { name: label })).toBeNull();
    },
  );
});
