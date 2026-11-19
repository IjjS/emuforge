import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import type { Role } from '../api';
import { trustedEntitiesText } from '../format';
import { SERVICE_LINKED_REASON, TrustTab } from './trust-tab';

// Test criteria, "Unit s2 — providers/aws/area/services/iam/components/trust-tab.test.tsx" (issue 535, task 1): the
// tab shows what the page read, and asks nothing of the engine. "Unit s4" (task 4): "Edit trust policy" opens the
// editor with the document as the tab shows it, and is unavailable for a service-linked role with its reason.

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: 'http://127.0.0.1:8899' };

function role(trust: string | undefined, path = '/'): Role {
  return {
    name: 'team-role',
    path,
    tags: [],
    ...(trust === undefined ? {} : { trustPolicy: encodeURIComponent(trust) }),
  };
}

/** The area's root, as the area's layout holds it, where the area's modals open. */
function Area({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>{children}</AreaRootContext>
    </div>
  );
}

function show(shown: Role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Area>
          <TrustTab role={shown} connection={CONNECTION} />
        </Area>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function editButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Edit trust policy' });
}

/** A Cloudscape button is disabled by `disabled`, or with a reason by `aria-disabled`. */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** A disabled button's reason, as Cloudscape names it to assistive technology. */
function disabledReason(element: HTMLElement): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

function entities(): string {
  const heading = screen.getByRole('heading', { level: 2, name: 'Trusted entities' });
  const trust = screen.getByRole('heading', { level: 2, name: 'Trust policy' });
  return [...document.querySelectorAll('.aws-area-value')]
    .filter(
      (value) =>
        heading.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING &&
        value.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    .map((value) => value.textContent ?? '')
    .join('');
}

function trustPolicy(): string | undefined {
  return document.querySelector('.aws-iam-policy-document')?.textContent ?? undefined;
}

const LAMBDA = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

describe('"Trust relationships"', () => {
  it('"Trusted entities" shows what the list’s column shows for the role; "Trust policy" the document indented', () => {
    const shown = role(LAMBDA);
    show(shown);

    expect(entities()).toBe(trustedEntitiesText(shown.trustPolicy, shown.path));
    expect(entities()).toBe('AWS Service: lambda');
    expect(trustPolicy()).toBe(JSON.stringify(JSON.parse(LAMBDA), null, 2));
    expect(trustPolicy()?.split('\n').length).toBeGreaterThan(5);
  });

  it('the section "Trusted entities" shows the description "Who may assume this role." (fix s6)', () => {
    show(role(LAMBDA));

    const header = createWrapper(document.body)
      .findAllHeaders()
      .find((found) => (found.findHeadingText().getElement().textContent ?? '').trim() === 'Trusted entities');
    expect(header).toBeDefined();
    expect((header?.findDescription()?.getElement().textContent ?? '').trim()).toBe('Who may assume this role.');
  });

  it('a service-linked role: the entities as the list shows them, with " (Service-linked role)"', () => {
    const shown = role(LAMBDA, '/aws-service-role/lambda.amazonaws.com/');
    show(shown);

    expect(entities()).toBe(trustedEntitiesText(shown.trustPolicy, shown.path));
    expect(entities()).toBe('AWS Service: lambda (Service-linked role)');
  });

  it('a policy that names no principal: "-"', () => {
    show(role(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole' }] })));

    expect(entities()).toBe('-');
  });

  it('a document that is not JSON: "-" for the entities, and the document as it came', () => {
    const text = 'not { json\n  at all';
    show(role(text));

    expect(entities()).toBe('-');
    expect(trustPolicy()).toBe(text);
  });

  it('a document with markup is shown as text', () => {
    const text = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Sid: '<img src=x onerror=alert(1)>', Effect: 'Allow', Principal: '*', Action: 'sts:AssumeRole' }],
    });
    show(role(text));

    expect(trustPolicy()).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('"Edit trust policy" (task 4)', () => {
  it('opens the editor "Trust policy" holding the document as the tab shows it, indented; nothing is sent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      show(role(LAMBDA));
      expect(isDisabled(editButton())).toBe(false);

      fireEvent.click(editButton());

      const dialog = await screen.findByRole('dialog', { name: 'Edit trust policy' });
      const field = within(dialog).getByRole('textbox', { name: /Trust policy/ }) as HTMLTextAreaElement;
      expect(field.value).toBe(trustPolicy());
      expect(field.value).toBe(JSON.stringify(JSON.parse(LAMBDA), null, 2));
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a document that is not JSON: the editor holds it as it came', async () => {
    const text = 'not { json\n  at all';
    show(role(text));

    fireEvent.click(editButton());

    const dialog = await screen.findByRole('dialog', { name: 'Edit trust policy' });
    expect((within(dialog).getByRole('textbox', { name: /Trust policy/ }) as HTMLTextAreaElement).value).toBe(text);
  });

  it('a service-linked role: unavailable, with the requirement’s reason, and no dialog opens', () => {
    show(role(LAMBDA, '/aws-service-role/lambda.amazonaws.com/'));

    expect(isDisabled(editButton())).toBe(true);
    expect(disabledReason(editButton())).toContain(
      "The emulator does not let a service-linked role's policies or trust policy be changed.",
    );
    expect(SERVICE_LINKED_REASON).toBe(
      "The emulator does not let a service-linked role's policies or trust policy be changed.",
    );
    fireEvent.click(editButton());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
