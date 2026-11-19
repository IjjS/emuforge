import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import { AreaRootContext } from '../../../area-root';
import * as api from '../api';
import { EditPolicyDialog } from './edit-policy-dialog';

// Test criteria, "Unit s5 — providers/aws/area/services/iam/components/edit-policy-dialog.test.tsx" (issue 535).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getPolicyDocument: vi.fn(), createPolicyVersion: vi.fn(), getPolicy: vi.fn() };
});

const getPolicyDocument = vi.mocked(api.getPolicyDocument);
const createPolicyVersion = vi.mocked(api.createPolicyVersion);

const ARN = 'arn:aws:iam::000000000000:policy/p-five';
const DOC_A =
  '{\n  "Version": "2012-10-17",\n  "Statement":  [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"}]\n}';
const DOC_B =
  '{"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:PutObject", "Resource": "*"}]}';
const CONNECTION: AreaConnection = { result: undefined, engineOrigin: 'http://127.0.0.1:8777' };

let shown: FlashResult[];
let onSaved: ReturnType<typeof vi.fn<(versionId: string) => void>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;

function Holder({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const flash: PageFlash = {
    show: (result) => {
      shown.push(result);
    },
    handOver: () => undefined,
  };
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div ref={root}>{children}</div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Holder>
          <EditPolicyDialog
            policy={{ arn: ARN, name: 'p-five' }}
            connection={CONNECTION}
            onSaved={onSaved}
            onClose={onClose}
          />
        </Holder>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  shown = [];
  onSaved = vi.fn();
  onClose = vi.fn();
  getPolicyDocument.mockReset();
  createPolicyVersion.mockReset();
  getPolicyDocument.mockResolvedValue({ kind: 'found', text: DOC_A, versionId: 'v5', isDefault: true });
});

async function field(): Promise<HTMLTextAreaElement> {
  const dialog = await screen.findByRole('dialog');
  return (await within(dialog).findByRole('textbox')) as HTMLTextAreaElement;
}

function save() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }));
}

describe('"Edit" of a policy', () => {
  it('holds the default version’s document as the emulator returns it', async () => {
    open();

    expect((await field()).value).toBe(DOC_A);
    expect(getPolicyDocument).toHaveBeenCalledTimes(1);
    expect(getPolicyDocument.mock.calls[0]?.slice(1, 3)).toEqual([ARN, undefined]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Edit p-five')).toBeTruthy();
    expect(dialog.textContent).toContain('Saving creates a new version and makes it the default.');
  });

  it('shows the message for a text that is not JSON and sends nothing', async () => {
    open();
    fireEvent.change(await field(), { target: { value: '{"Version": ' } });
    save();

    expect(await screen.findByText('Enter the policy as one JSON value.')).toBeTruthy();
    expect(createPolicyVersion).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends one request for a valid text; a success reports the new version and closes', async () => {
    createPolicyVersion.mockResolvedValue('v6');
    open();
    fireEvent.change(await field(), { target: { value: DOC_B } });
    save();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(createPolicyVersion).toHaveBeenCalledTimes(1);
    expect(createPolicyVersion.mock.calls[0]?.slice(1, 3)).toEqual([ARN, DOC_B]);
    expect(onSaved).toHaveBeenCalledWith('v6');
    expect(shown).toEqual([[{ type: 'success', content: 'p-five saved as version v6, now the default.' }]]);
  });

  it('stays open on a refusal, with the code and message and what was typed', async () => {
    createPolicyVersion.mockRejectedValue(
      new api.IamError({
        kind: 'other',
        operation: 'CreatePolicyVersion',
        code: 'LimitExceeded',
        message: 'A managed policy can have up to 5 versions.',
      }),
    );
    open();
    fireEvent.change(await field(), { target: { value: DOC_B } });
    save();

    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent).toContain('LimitExceeded: A managed policy can have up to 5 versions.');
    });
    expect(createPolicyVersion).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(shown).toEqual([]);
    expect((await field()).value).toBe(DOC_B);
  });

  describe('leaving with a changed text', () => {
    function editDialog(): HTMLElement {
      const dialog = screen.getAllByRole('dialog').find((d) => d.textContent?.includes('Edit p-five'));
      if (dialog === undefined) {
        throw new Error('the edit dialog is not open');
      }
      return dialog;
    }
    function pressEsc() {
      fireEvent.keyDown(within(editDialog()).getByRole('textbox'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    }
    const ways: [string, () => void][] = [
      ['Esc', pressEsc],
      ['X', () => fireEvent.click(within(editDialog()).getByRole('button', { name: 'Close dialog' }))],
      ['Cancel', () => fireEvent.click(within(editDialog()).getByRole('button', { name: 'Cancel' }))],
    ];

    it.each(ways)('%s with the text unchanged closes at once', async (_, leave) => {
      open();
      await field();
      leave();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Discard what you entered?')).toBeNull();
    });

    it.each(ways)('%s with a changed text asks first; "Keep editing" keeps what was typed', async (_, leave) => {
      open();
      fireEvent.change(await field(), { target: { value: DOC_B } });
      leave();

      expect(await screen.findByText('Discard what you entered?')).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

      await waitFor(() => {
        expect(screen.queryByText('Discard what you entered?')).toBeNull();
      });
      expect(onClose).not.toHaveBeenCalled();
      expect((within(editDialog()).getByRole('textbox') as HTMLTextAreaElement).value).toBe(DOC_B);
    });

    it.each(ways)('%s with a changed text closes only on "Discard"', async (_, leave) => {
      open();
      fireEvent.change(await field(), { target: { value: DOC_B } });
      leave();

      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(createPolicyVersion).not.toHaveBeenCalled();
    });

    it('a text typed back to what it opened with closes at once', async () => {
      open();
      const text = await field();
      fireEvent.change(text, { target: { value: DOC_B } });
      fireEvent.change(text, { target: { value: DOC_A } });
      fireEvent.click(within(editDialog()).getByRole('button', { name: 'Cancel' }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Discard what you entered?')).toBeNull();
    });
  });
});
