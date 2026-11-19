import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { AreaConnection } from '../../../components/emulator-line';
import type { InlineDocumentRead, ManagedDocumentRead } from '../api';
import { useInlinePolicyDocument, type DocumentQuery } from '../queries';
import { PolicyDocument } from './policy-document';

// Test criteria, "Unit s1 — providers/aws/area/services/iam/components/policy-document.test.tsx" (issue 535).

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: 'http://127.0.0.1:8899' };
const ARN = 'arn:aws:iam::aws:policy/p-absent';

function query(
  state: Partial<DocumentQuery<InlineDocumentRead | ManagedDocumentRead>>,
): DocumentQuery<InlineDocumentRead | ManagedDocumentRead> {
  return { read: undefined, failure: undefined, loading: false, refresh: () => undefined, ...state };
}

function show(state: Partial<DocumentQuery<InlineDocumentRead | ManagedDocumentRead>>, arn?: string) {
  return render(
    <MemoryRouter>
      <PolicyDocument
        source={{ kind: 'query', query: query(state) }}
        connection={CONNECTION}
        {...(arn === undefined ? {} : { arn })}
      />
    </MemoryRouter>,
  );
}

describe('a policy document', () => {
  it('says "Loading the policy document" while it is read', () => {
    show({ loading: true });
    expect(screen.getByText('Loading the policy document')).toBeTruthy();
  });

  it('shows the text exactly, line breaks and spaces kept, and markup as text', () => {
    const text = '{\n  "Version":  "2012-10-17",\n\t"Sid": "<b>bold</b> & <script>x</script>"\n}';
    const { container } = show({ read: { kind: 'found', text } });

    const shown = container.querySelector('.aws-iam-policy-document');
    expect(shown?.textContent).toBe(text);
    expect(shown?.closest('code, pre, [class*="code"]')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('says "Policy not found" with the sentence that names the ARN', () => {
    const { container } = show({ read: { kind: 'not-found' } }, ARN);
    expect(screen.getByText('Policy not found')).toBeTruthy();
    expect(container.textContent).toContain(
      `The emulator holds no policy with the ARN ${ARN}. A role can still name it.`,
    );
  });

  it('shows a failed read in the failure’s words', () => {
    const { container } = show({
      failure: { kind: 'access-denied', operation: 'GetPolicyVersion', message: 'not authorized' },
    });
    expect(screen.getByText('Access denied')).toBeTruthy();
    expect(container.textContent).toContain('GetPolicyVersion was refused: not authorized');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('a failed policy document read with "Retry"', () => {
  let sent: string[];
  let refuse: boolean;
  let client: QueryClient;

  beforeEach(() => {
    sent = [];
    refuse = true;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === '/__emuforge/session') {
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      }
      const action = new URLSearchParams(await request.text()).get('Action') ?? '';
      sent.push(action);
      if (refuse) {
        return new Response(
          '<ErrorResponse><Error><Type>Sender</Type><Code>InvalidInput</Code><Message>try later</Message></Error></ErrorResponse>',
          { status: 400 },
        );
      }
      return new Response(
        `<GetRolePolicyResponse><GetRolePolicyResult><RoleName>r</RoleName><PolicyName>p</PolicyName><PolicyDocument>${encodeURIComponent('{"a": 1}')}</PolicyDocument></GetRolePolicyResult></GetRolePolicyResponse>`,
        { status: 200 },
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    client.clear();
  });

  function Read() {
    const read = useInlinePolicyDocument({ endpoint: engineEndpoint(8898), role: 'r', policy: 'p', enabled: true });
    return <PolicyDocument source={{ kind: 'query', query: read }} connection={CONNECTION} />;
  }

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }

  it('reads again and shows the text', async () => {
    const { container } = render(<Read />, { wrapper });
    await waitFor(() => {
      expect(container.textContent).toContain('InvalidInput');
    });
    expect(container.textContent).toContain('try later');
    expect(sent.filter((action) => action === 'GetRolePolicy').length).toBeGreaterThanOrEqual(1);
    const before = sent.length;

    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(container.querySelector('.aws-iam-policy-document')?.textContent).toBe('{"a": 1}');
    });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toBe('GetRolePolicy');
  });
});
