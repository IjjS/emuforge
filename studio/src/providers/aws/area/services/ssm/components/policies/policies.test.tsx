import type {
  DeleteResourcePolicyCommandInput,
  DescribeParametersCommandInput,
  GetResourcePoliciesCommandInput,
  PutResourcePolicyCommandInput,
} from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import AwsArea from '../../../../index';
import { parameterPath } from '../../paths';

afterEach(() => vi.unstubAllGlobals());

const NAME = '/app/database/host';
const ARN = 'arn:aws:ssm:us-east-1:000000000000:parameter/app/database/host';

const connected = {
  kind: 'connected',
  checkedAt: 1,
  target: 'local',
  emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
} as const;
let nextPort = 8800;

function answer(body: object = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function denied(message: string) {
  return answer({ __type: 'AccessDeniedException', message }, 403);
}

function notImplemented() {
  return answer({ __type: 'NotImplemented' }, 501);
}

function metadata(Tier = 'Advanced', Description = 'Initial metadata', Policies: object[] = []) {
  return answer({ Parameters: [{ Name: NAME, ARN, Version: 1, Type: 'String', Tier, Description, Policies }] });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  return { response, finish: async (reply: Response) => act(async () => resolve(reply)) };
}

function openDetail() {
  const engineOrigin = `http://127.0.0.1:${nextPort++}`;
  const operations = {
    DescribeParameters: vi.fn<(input: DescribeParametersCommandInput) => Response | Promise<Response>>(() =>
      metadata(),
    ),
    GetResourcePolicies: vi.fn<(input: GetResourcePoliciesCommandInput) => Response | Promise<Response>>(() =>
      answer(),
    ),
    PutResourcePolicy: vi.fn<(input: PutResourcePolicyCommandInput) => Response>(() => answer()),
    DeleteResourcePolicy: vi.fn<(input: DeleteResourcePolicyCommandInput) => Response>(() => answer()),
  };

  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    if (!Object.hasOwn(operations, operation)) throw new Error(`Unexpected AWS request: ${operation}`);
    const handler = operations[operation as keyof typeof operations] as (data: unknown) => Response | Promise<Response>;
    return handler(await request.json());
  });

  const router = createMemoryRouter(
    [
      {
        path: '/aws/*',
        element: (
          <AwsArea
            connection={{ engineOrigin, result: connected }}
            headerSelector="#top-bar"
            routeChanges={0}
            onPageTitle={() => undefined}
            onContentTarget={() => undefined}
          />
        ),
      },
    ],
    { initialEntries: [parameterPath(NAME)] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return operations;
}

const page = createWrapper(document.body);
const section = () =>
  page
    .findAllExpandableSections()
    .find((candidate) => candidate.findHeaderText()?.getElement().textContent === 'Resource policies');
const sectionContent = () => section()?.findContent();
const metadataContent = () =>
  page
    .findAllContainers()
    .find(
      (container) =>
        container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === 'Parameter details',
    )
    ?.findContent();
const description = () =>
  metadataContent()
    ?.findKeyValuePairs()
    ?.findItems()
    .find((item) => item.findLabel()?.getElement().textContent === 'Description')
    ?.findValue()
    ?.getElement();

const expectDescription = (text: string) =>
  waitFor(() => {
    const value = description();
    expect(value).toBeVisible();
    expect(value?.textContent).toBe(text);
  });

async function expand() {
  const toggle = await waitFor(() => {
    const button = section()?.findExpandButton().getElement();
    assert(button);
    expect(button).toHaveAccessibleName('Resource policies');
    return button;
  });
  fireEvent.click(toggle);
}

type Dialog = NonNullable<ReturnType<typeof page.findModal>>;

function button(name: string, dialog?: Dialog) {
  if (!dialog) return screen.getByRole('button', { name });
  const footer = dialog.findFooter();
  assert(footer);
  return within(footer.getElement()).getByRole('button', { name });
}

function flash(message: string) {
  return page
    .findFlashbar()
    ?.findItemsByType('success')
    .map((item) => item.findContent()?.getElement())
    .find((content) => content?.textContent === message);
}

function expectUnsupported(operation: string) {
  return waitFor(() => {
    const message = `The emulator answered 501 Not Implemented for ${operation}.`;
    const alert = sectionContent()
      ?.findAllAlerts()
      .find((item) => item.findContent().getElement().textContent === message);
    expect(alert?.findContent().getElement()).toBeVisible();
    expect(alert?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
  });
}

const DOCUMENT = '{"Statement":[{"Action":"ssm:GetParameter"}]}';
const UPDATED = '{"Statement":[{"Action":"ssm:GetParameters"}]}';
const DISPLAY_DOCUMENT = `{
  "Statement": [
    {
      "Action": "ssm:GetParameter"
    }
  ]
}`;
const DISPLAY_UPDATED = DISPLAY_DOCUMENT.replace('ssm:GetParameter', 'ssm:GetParameters');
const POLICY_TEXT = { normalizer: (text: string) => text };

function policies() {
  const content = sectionContent();
  assert(content);
  return within(content.getElement());
}

function expectLifetimePolicy(text: string) {
  const content = metadataContent();
  assert(content);
  expect(within(content.getElement()).getByText(text, POLICY_TEXT)).toBeVisible();
}

function policyInput(dialog: Dialog, name: string) {
  const content = dialog.findContent();
  const input =
    name === 'Confirmation'
      ? content.findInput()?.findNativeInput().getElement()
      : content.findTextarea()?.findNativeTextarea().getElement();
  assert(input);
  expect(input).toHaveAccessibleName(name);
  return input;
}

function change(dialog: Dialog, name: string, value: string) {
  fireEvent.change(policyInput(dialog, name), { target: { value } });
}
const POLICY = { PolicyId: 'policy-1', PolicyHash: 'hash-1', Policy: DOCUMENT };
const UPDATED_POLICY = { PolicyId: POLICY.PolicyId, PolicyHash: 'hash-2', Policy: UPDATED };
const SECOND = { PolicyId: 'policy-2', PolicyHash: 'hash-3', Policy: '{"Statement":[]}' };
const editName = 'Edit resource policy policy-1';
const deleteName = 'Delete resource policy policy-1';
const created = `Resource policy created for ${NAME}.`;
const updated = `Resource policy updated for ${NAME}.`;
const deleted = `Resource policy ${POLICY.PolicyId} deleted from ${NAME}.`;
const list = (Policies: (typeof POLICY)[] = [], NextToken?: string) => answer({ Policies, NextToken });

async function policyDialog(name: string, title = name) {
  fireEvent.click(button(name));
  return waitFor(() => {
    const dialog = page.findModal();
    assert(dialog);
    expect(dialog.findHeader().getElement().textContent).toBe(title);
    expect(dialog.getElement()).toBeVisible();
    expect(dialog.getElement()).toHaveAccessibleName(title);
    return dialog;
  });
}

describe('Parameter resource policies', () => {
  it('P1 loads policies only for opened Advanced sections and keeps lifetime policies separate', async () => {
    const ops = openDetail();
    const lifetimePolicy = '{"Type":"Expiration","Attributes":{"Timestamp":"2031-01-01T00:00:00Z"}}';
    ops.DescribeParameters.mockImplementationOnce(() =>
      metadata('Standard', 'Standard metadata', [{ PolicyType: 'Expiration', PolicyText: lifetimePolicy }]),
    );
    await expectDescription('Standard metadata');
    expectLifetimePolicy(
      '{\n  "Type": "Expiration",\n  "Attributes": {\n    "Timestamp": "2031-01-01T00:00:00Z"\n  }\n}',
    );
    expect(section()).toBeUndefined();
    expect(ops.GetResourcePolicies).not.toHaveBeenCalled();
  });

  it('P1 opens the Advanced ARN and starts the resource policy editor with an empty document', async () => {
    const ops = openDetail();
    const lifetimePolicy = '{"Type":"Expiration"}';
    ops.DescribeParameters.mockImplementationOnce(() =>
      metadata('Advanced', 'Advanced metadata', [{ PolicyType: 'Expiration', PolicyText: lifetimePolicy }]),
    );
    await expectDescription('Advanced metadata');
    expect(ops.GetResourcePolicies).not.toHaveBeenCalled();
    await expand();
    expect(await policies().findByText('No resource policies')).toBeVisible();
    expect(ops.GetResourcePolicies).toHaveBeenCalledExactlyOnceWith({ ResourceArn: ARN });

    const dialog = await policyDialog('Create resource policy');
    expect(policyInput(dialog, 'Policy document')).toHaveValue('');
    fireEvent.click(button('Cancel', dialog));
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY]));
    fireEvent.click(button('Refresh resource policies'));
    expect(await policies().findByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeVisible();
    expectLifetimePolicy('{\n  "Type": "Expiration"\n}');
  });

  it('shows the original policy text when JSON formatting fails', async () => {
    const ops = openDetail();
    const original = '  { invalid policy\n  text  ';
    ops.GetResourcePolicies.mockImplementationOnce(() => list([{ ...POLICY, Policy: original }]));
    await expand();
    expect(await policies().findByText(original, POLICY_TEXT)).toBeVisible();

    const edit = await policyDialog(editName, 'Edit resource policy');
    expect(policyInput(edit, 'Policy document')).toHaveValue(original);
  });

  it('P2 creates and updates the same policy, retaining its document and result across metadata refresh', async () => {
    const ops = openDetail();
    await expand();
    await policies().findByText('No resource policies');

    const afterCreate = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(afterCreate.response);
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY]));
    const create = await policyDialog('Create resource policy');
    change(create, 'Policy document', DOCUMENT);
    fireEvent.click(button('Save resource policy', create));
    expect(await policies().findByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeVisible();
    expect(flash(created)).toBeVisible();
    await afterCreate.finish(metadata('Advanced', 'Metadata after create'));
    await expectDescription('Metadata after create');
    expect(flash(created)).toBeVisible();

    const afterUpdate = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(afterUpdate.response);
    ops.GetResourcePolicies.mockImplementationOnce(() => list([UPDATED_POLICY]));
    const edit = await policyDialog(editName, 'Edit resource policy');
    expect(policyInput(edit, 'Policy document')).toHaveValue(DOCUMENT);
    change(edit, 'Policy document', UPDATED);
    fireEvent.click(button('Save resource policy', edit));
    expect(await policies().findByText(DISPLAY_UPDATED, POLICY_TEXT)).toBeVisible();
    expect(ops.DescribeParameters).toHaveBeenCalledTimes(3);
    await afterUpdate.finish(metadata('Advanced', 'Metadata after update'));
    await expectDescription('Metadata after update');
    expect(policies().getByText(DISPLAY_UPDATED, POLICY_TEXT)).toBeVisible();
    expect(flash(updated)).toBeVisible();
    expect(ops.PutResourcePolicy.mock.calls).toEqual([
      [{ ResourceArn: ARN, Policy: DOCUMENT }],
      [{ ResourceArn: ARN, Policy: UPDATED, PolicyId: POLICY.PolicyId, PolicyHash: POLICY.PolicyHash }],
    ]);
  });

  it('P3 confirms by name and ID, cancels safely, and deletes using the latest read revision', async () => {
    const ops = openDetail();
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY]));
    await expand();
    await policies().findByText(DISPLAY_DOCUMENT, POLICY_TEXT);
    const canceled = await policyDialog(deleteName, 'Delete resource policy');
    expect(within(canceled.findContent().getElement()).getByText(POLICY.PolicyId)).toBeVisible();
    expect(canceled.findContent().getElement()).toHaveTextContent(
      `This removes the resource policy from ${NAME} in your local emulator. Type delete to confirm.`,
    );
    const confirm = button('Delete resource policy', canceled);
    expect(confirm).toBeDisabled();
    change(canceled, 'Confirmation', 'DELETE');
    expect(confirm).toBeDisabled();
    change(canceled, 'Confirmation', 'delete');
    expect(confirm).toBeEnabled();
    fireEvent.click(button('Cancel', canceled));
    expect(ops.DeleteResourcePolicy).not.toHaveBeenCalled();
    expect(policies().getByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeVisible();

    ops.GetResourcePolicies.mockImplementationOnce(() => list([UPDATED_POLICY]));
    fireEvent.click(button('Refresh resource policies'));
    await policies().findByText(DISPLAY_UPDATED, POLICY_TEXT);
    const delayed = deferredResponse();
    ops.DescribeParameters.mockReturnValueOnce(delayed.response);
    const dialog = await policyDialog(deleteName, 'Delete resource policy');
    change(dialog, 'Confirmation', 'delete');
    fireEvent.click(button('Delete resource policy', dialog));
    expect(await policies().findByText('No resource policies')).toBeVisible();
    expect(ops.DeleteResourcePolicy).toHaveBeenCalledExactlyOnceWith({
      ResourceArn: ARN,
      PolicyId: POLICY.PolicyId,
      PolicyHash: UPDATED_POLICY.PolicyHash,
    });
    await delayed.finish(metadata('Advanced', 'Metadata after policy delete'));
    await expectDescription('Metadata after policy delete');
    expect(policies().getByText('No resource policies')).toBeVisible();
    expect(flash(deleted)).toBeVisible();
  });

  it('P4 preserves the denied policy document and submits the corrected version on retry', async () => {
    const ops = openDetail();
    ops.PutResourcePolicy.mockImplementationOnce(() => denied('Policy save denied'));
    await expand();
    await policies().findByText('No resource policies');
    const dialog = await policyDialog('Create resource policy');
    change(dialog, 'Policy document', DOCUMENT);
    fireEvent.click(button('Save resource policy', dialog));
    await waitFor(() => {
      const reason = dialog.findContent().findAlert()?.findContent().getElement();
      expect(reason).toBeVisible();
      expect(reason).toHaveTextContent(/Policy save denied/);
    });
    expect(policyInput(dialog, 'Policy document')).toHaveValue(DOCUMENT);
    expect(flash(created)).toBeUndefined();
    ops.GetResourcePolicies.mockImplementationOnce(() => list([UPDATED_POLICY]));
    change(dialog, 'Policy document', UPDATED);
    fireEvent.click(button('Save resource policy', dialog));
    await waitFor(() => expect(flash(created)).toBeVisible());
    expect(await policies().findByText(DISPLAY_UPDATED, POLICY_TEXT)).toBeVisible();
    expect(ops.PutResourcePolicy).toHaveBeenLastCalledWith({ ResourceArn: ARN, Policy: UPDATED });
  });

  it('P5 names and disables the unsupported read operation', async () => {
    const ops = openDetail();
    ops.GetResourcePolicies.mockImplementationOnce(notImplemented);
    await expand();
    await expectUnsupported('GetResourcePolicies');
    expect(button('Refresh resource policies')).toBeDisabled();
    expect(button('Create resource policy')).toBeEnabled();
    expect(policies().queryByText('No resource policies')).toBeNull();
  });

  it.each([
    ['PutResourcePolicy', editName, 'Edit resource policy', 'Save resource policy', deleteName],
    ['DeleteResourcePolicy', deleteName, 'Delete resource policy', 'Delete resource policy', editName],
  ] as const)('P5 isolates unsupported %s', async (operation, action, title, submit, other) => {
    const ops = openDetail();
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY]));
    ops[operation].mockImplementationOnce(notImplemented);
    await expand();
    await policies().findByText(DISPLAY_DOCUMENT, POLICY_TEXT);
    const dialog = await policyDialog(action, title);
    if (operation === 'DeleteResourcePolicy') change(dialog, 'Confirmation', 'delete');
    fireEvent.click(button(submit, dialog));
    await expectUnsupported(operation);
    expect(button(action)).toBeDisabled();
    expect(button(other)).toBeEnabled();
    expect(button('Refresh resource policies')).toBeEnabled();
    expect(policies().getByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeVisible();
  });

  it('P6 retries a failed continuation from the first page and reports the service reason', async () => {
    const ops = openDetail();
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY], 'next'))
      .mockImplementationOnce(() => answer({ __type: 'ValidationException', message: 'Policy page unavailable' }, 400))
      .mockImplementationOnce(() => list([SECOND]));
    await expand();
    expect(await policies().findByText(/Policy page unavailable/)).toBeVisible();
    expect(policies().queryByText('No resource policies')).toBeNull();
    expect(policies().queryByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeNull();
    fireEvent.click(button('Retry'));
    expect(await policies().findByText('{\n  "Statement": []\n}', POLICY_TEXT)).toBeVisible();
    expect(ops.GetResourcePolicies).toHaveBeenLastCalledWith({ ResourceArn: ARN });
  });

  it('P7 keeps the existing policy when confirmed deletion is denied and allows retry', async () => {
    const ops = openDetail();
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY]));
    ops.DeleteResourcePolicy.mockImplementationOnce(() => denied('Policy deletion denied'));
    await expand();
    await policies().findByText(DISPLAY_DOCUMENT, POLICY_TEXT);
    const dialog = await policyDialog(deleteName, 'Delete resource policy');
    change(dialog, 'Confirmation', 'delete');
    fireEvent.click(button('Delete resource policy', dialog));
    await waitFor(() => {
      const reason = dialog.findContent().findAlert()?.findContent().getElement();
      expect(reason).toBeVisible();
      expect(reason).toHaveTextContent(/Policy deletion denied/);
    });
    expect(policies().getByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeInTheDocument();
    expect(flash(deleted)).toBeUndefined();
    expect(button('Delete resource policy', dialog)).toBeEnabled();
    fireEvent.click(button('Delete resource policy', dialog));
    await waitFor(() => expect(flash(deleted)).toBeVisible());
    expect(await policies().findByText('No resource policies')).toBeVisible();
    expect(ops.DeleteResourcePolicy).toHaveBeenCalledTimes(2);
  });

  it('P8 follows the token for the same ARN and shows both policies', async () => {
    const ops = openDetail();
    ops.GetResourcePolicies.mockImplementationOnce(() => list([POLICY], 'next')).mockImplementationOnce(() =>
      list([SECOND]),
    );
    await expand();
    expect(await policies().findByText(DISPLAY_DOCUMENT, POLICY_TEXT)).toBeVisible();
    expect(policies().getByText('{\n  "Statement": []\n}', POLICY_TEXT)).toBeVisible();
    expect(ops.GetResourcePolicies.mock.calls).toEqual([
      [{ ResourceArn: ARN }],
      [{ ResourceArn: ARN, NextToken: 'next' }],
    ]);
  });
});
