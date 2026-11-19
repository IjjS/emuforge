import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import { AreaRootContext } from '../../../area-root';
import * as api from '../api';
import type { DeletePolicyResult, IamFailure, PolicyEntity } from '../api';
import { usePolicy } from '../queries';
import { DeletePolicyDialog } from './delete-policy-dialog';

// Test criteria, "Unit s5 — providers/aws/area/services/iam/components/delete-policy-dialog.test.tsx" (issue 535).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getPolicy: vi.fn(), deletePolicy: vi.fn() };
});

const getPolicy = vi.mocked(api.getPolicy);
const deletePolicy = vi.mocked(api.deletePolicy);

const ARN = 'arn:aws:iam::000000000000:policy/p-used';
const ENDPOINT = 'http://127.0.0.1:8778';
const CONNECTION: AreaConnection = { result: undefined, engineOrigin: ENDPOINT };
const ENTITIES: PolicyEntity[] = [
  { kind: 'role', name: 'p-r' },
  { kind: 'user', name: 'p-u' },
  { kind: 'group', name: 'p-g' },
];

let shown: FlashResult[];
let handedOver: [string, FlashResult][];
let onClose: ReturnType<typeof vi.fn<() => void>>;

/** A page's read of the policy, as the policy's page holds it, so a read again is seen. */
function PolicyReader() {
  usePolicy({ endpoint: ENDPOINT, arn: ARN });
  return null;
}

function Holder({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const flash: PageFlash = {
    show: (result) => {
      shown.push(result);
    },
    handOver: (to, result) => {
      handedOver.push([to, result]);
    },
  };
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div ref={root}>{children}</div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

function open(entities: readonly PolicyEntity[] | undefined, from: 'list' | 'page' = 'page') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Holder>
          <PolicyReader />
          <DeletePolicyDialog
            policy={{ arn: ARN, name: 'p-used' }}
            entities={entities}
            from={from}
            connection={CONNECTION}
            onClose={onClose}
          />
        </Holder>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  shown = [];
  handedOver = [];
  onClose = vi.fn();
  getPolicy.mockReset();
  deletePolicy.mockReset();
  getPolicy.mockResolvedValue({ kind: 'not-found' });
});

async function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirm() {
  const shownDialog = await dialog();
  fireEvent.change(within(shownDialog).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shownDialog).getByRole('button', { name: 'Delete' }));
}

describe('"Delete" of a policy', () => {
  it('names each entity with its kind and how many', async () => {
    open(ENTITIES);

    const shownDialog = await dialog();
    expect(within(shownDialog).getByText('Delete p-used?')).toBeTruthy();
    expect(shownDialog.textContent).toContain(
      'The policy and every version of it are removed from the local emulator. This cannot be undone.',
    );
    expect(shownDialog.textContent).toContain(
      'It is first detached from 3 entities: p-r (Role), p-u (User), p-g (Group).',
    );
  });

  it('has no such line when the policy is attached to nothing', async () => {
    open([]);

    expect((await dialog()).textContent).not.toContain('It is first detached');
  });

  it('reads what the policy is attached to itself when the page holds none (the policy list)', async () => {
    getPolicy.mockResolvedValue({
      kind: 'found',
      policy: { name: 'p-used', arn: ARN, type: 'Customer managed' },
      versions: { kind: 'read', items: [] },
      entities: { kind: 'read', items: [{ kind: 'role', name: 'p-r' }] },
    });
    open(undefined, 'list');

    const shownDialog = await dialog();
    await waitFor(() => {
      expect(shownDialog.textContent).toContain('It is first detached from 1 entity: p-r (Role).');
    });
  });

  it('keeps "Delete" unavailable until delete is typed', async () => {
    open(ENTITIES);
    const shownDialog = await dialog();
    const button = within(shownDialog).getByRole('button', { name: 'Delete' });

    expect(button).toBeDisabled();
    fireEvent.change(within(shownDialog).getByRole('textbox'), { target: { value: 'Delete' } });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(deletePolicy).not.toHaveBeenCalled();
    fireEvent.change(within(shownDialog).getByRole('textbox'), { target: { value: 'delete' } });
    expect(button).not.toBeDisabled();
  });

  it('leads from the policy’s page to the list with "Policy {name} deleted." on success', async () => {
    deletePolicy.mockResolvedValue({ kind: 'deleted', detachedRoles: ['p-r'] });
    open(ENTITIES);
    await confirm();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(deletePolicy).toHaveBeenCalledTimes(1);
    expect(deletePolicy.mock.calls[0]?.[1]).toBe(ARN);
    expect(handedOver).toEqual([['/aws/iam/policies', [{ type: 'success', content: 'Policy p-used deleted.' }]]]);
    expect(shown).toEqual([]);
  });

  it('shows "Policy {name} deleted." on the list itself when opened there', async () => {
    deletePolicy.mockResolvedValue({ kind: 'deleted', detachedRoles: [] });
    open([], 'list');
    await confirm();

    await waitFor(() => {
      expect(shown).toEqual([[{ type: 'success', content: 'Policy p-used deleted.' }]]);
    });
    expect(handedOver).toEqual([]);
  });

  const refusal: IamFailure = { kind: 'other', operation: 'X', code: 'NoSuchEntity', message: 'gone' };

  it.each<[string, DeletePolicyResult]>([
    [
      'Reading what the policy is attached to',
      { kind: 'failed', step: { kind: 'read-entities' }, failure: refusal, detachedRoles: [] },
    ],
    [
      "Reading the policy's versions",
      { kind: 'failed', step: { kind: 'read-versions' }, failure: refusal, detachedRoles: [] },
    ],
    [
      'Detaching it from p-u',
      {
        kind: 'failed',
        step: { kind: 'detach', entity: { kind: 'user', name: 'p-u' } },
        failure: refusal,
        detachedRoles: ['p-r'],
      },
    ],
    [
      'Deleting version v2',
      { kind: 'failed', step: { kind: 'delete-version', versionId: 'v2' }, failure: refusal, detachedRoles: [] },
    ],
    ['Deleting the policy', { kind: 'failed', step: { kind: 'delete-policy' }, failure: refusal, detachedRoles: [] }],
  ])('reports the failed step "%s" with the code and message, and reads the policy again', async (words, result) => {
    deletePolicy.mockResolvedValue(result);
    open(ENTITIES);
    await waitFor(() => {
      expect(getPolicy).toHaveBeenCalledTimes(1);
    });
    await confirm();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(shown).toHaveLength(1);
    const item = shown[0]?.[0];
    expect(item?.type).toBe('error');
    expect(item?.header).toBe(`${words} failed`);
    render(<>{item?.content}</>);
    expect(screen.getByText('NoSuchEntity')).toBeTruthy();
    expect(document.body.textContent).toContain('NoSuchEntity: gone');
    expect(handedOver).toEqual([]);
    await waitFor(() => {
      expect(getPolicy).toHaveBeenCalledTimes(2);
    });
  });
});
