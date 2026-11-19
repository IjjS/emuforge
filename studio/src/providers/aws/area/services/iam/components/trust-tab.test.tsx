import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import type { Role } from '../api';
import { trustedEntitiesText } from '../format';
import { TrustTab } from './trust-tab';

// Test criteria, "Unit s2 — providers/aws/area/services/iam/components/trust-tab.test.tsx" (issue 535, task 1): the
// tab shows what the page read, and asks nothing of the engine.

const CONNECTION: AreaConnection = { result: undefined, engineOrigin: 'http://127.0.0.1:8899' };

function role(trust: string | undefined, path = '/'): Role {
  return {
    name: 'team-role',
    path,
    tags: [],
    ...(trust === undefined ? {} : { trustPolicy: encodeURIComponent(trust) }),
  };
}

function show(shown: Role) {
  return render(
    <MemoryRouter>
      <TrustTab role={shown} connection={CONNECTION} />
    </MemoryRouter>,
  );
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
