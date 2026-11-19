import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { Role, RolePolicies } from '../api';
import { policyPath, policyTypeText, type PolicyRef } from '../format';
import { useInlinePolicyDocument, useManagedPolicyDocument } from '../queries';
import { readFailureState } from './failures';
import { NAME_COLUMN_MIN_WIDTH } from './page-parts';
import { PolicyDocument } from './policy-document';
import { BoundarySection } from './role-sections';
import { ReadFailure } from './states';

// The tab "Permissions" of a role's page (issue 535, task 1): "Permissions policies", each policy's document shown in
// place on its row's "Show document", then "Permissions boundary" as on `main`. A managed policy's name leads to its
// own page by its ARN; an inline policy's is text. Read-only here; issue 535's s3 adds the changes.

/** What a failed policy list names (R10.1). */
const POLICIES_THING = 'policies';

/** The narrowest the document's column gets, in pixels, so a document has room to be read in its row. */
const DOCUMENT_COLUMN_MIN_WIDTH = 360;

/** A policy's key among the role's: managed ones by their ARN, inline ones by their name. */
function policyKey(policy: PolicyRef): string {
  return `${policy.kind}:${policy.kind === 'managed' ? policy.arn : policy.name}`;
}

/** A managed policy's name, the link to its own page. */
function ManagedName({ name, arn }: { name: string; arn: string }) {
  const handleFollow = useFollow();
  return (
    <Link href={policyPath(arn)} onFollow={handleFollow}>
      <ValueText kind="name" value={name} />
    </Link>
  );
}

interface DocumentProps {
  role: string;
  connection: AreaConnection;
}

/** An inline policy's document, read while it is shown (`GetRolePolicy`). */
function InlineDocument({ role, name, connection }: DocumentProps & { name: string }) {
  const query = useInlinePolicyDocument({ endpoint: connection.engineOrigin, role, policy: name, enabled: true });
  return <PolicyDocument source={{ kind: 'query', query }} connection={connection} />;
}

/** A managed policy's default document, read while it is shown (`GetPolicy`, `GetPolicyVersion`). */
function ManagedDocument({ arn, connection }: DocumentProps & { arn: string }) {
  const query = useManagedPolicyDocument({ endpoint: connection.engineOrigin, arn, enabled: true });
  return <PolicyDocument source={{ kind: 'query', query }} arn={arn} connection={connection} />;
}

interface DocumentCellProps extends DocumentProps {
  policy: PolicyRef;
  open: boolean;
  onToggle: (policy: PolicyRef) => void;
}

/** "Show document" or "Hide document", and the document under it while it is shown; each row keeps its own read. */
function DocumentCell({ policy, open, onToggle, role, connection }: DocumentCellProps) {
  return (
    <SpaceBetween size="xs">
      <Button
        variant="inline-link"
        ariaExpanded={open}
        ariaLabel={`${open ? 'Hide document' : 'Show document'} of ${policy.name}`}
        onClick={() => {
          onToggle(policy);
        }}
      >
        {open ? 'Hide document' : 'Show document'}
      </Button>
      {open &&
        (policy.kind === 'inline' ? (
          <InlineDocument role={role} name={policy.name} connection={connection} />
        ) : (
          <ManagedDocument role={role} arn={policy.arn} connection={connection} />
        ))}
    </SpaceBetween>
  );
}

export interface PermissionsTabProps {
  role: Role;
  policies: RolePolicies;
  connection: AreaConnection;
  /** "Retry" of a failed list: reads the role again. */
  onRetry: () => void;
}

/**
 * "Permissions policies": the attached policies, then the inline ones, with their documents on demand; a failed list
 * shows its state in the table's place, the table's heading and columns kept (R10.1). Then "Permissions boundary".
 */
export function PermissionsTab({ role, policies, connection, onRetry }: PermissionsTabProps) {
  // The keys of the rows whose document is shown, in no order.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const handleToggle = useCallback((policy: PolicyRef) => {
    const key = policyKey(policy);
    setShown((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }, []);

  const items = policies.kind === 'read' ? policies.items : [];
  const columns: TableProps.ColumnDefinition<PolicyRef>[] = [
    {
      id: 'name',
      header: 'Policy name',
      isRowHeader: true,
      minWidth: NAME_COLUMN_MIN_WIDTH,
      cell: (policy) =>
        policy.kind === 'managed' ? (
          <ManagedName name={policy.name} arn={policy.arn} />
        ) : (
          <ValueText kind="name" value={policy.name} />
        ),
    },
    { id: 'type', header: 'Type', cell: (policy) => <ValueText kind="fixed" value={policyTypeText(policy)} /> },
    {
      id: 'document',
      header: 'Document',
      minWidth: DOCUMENT_COLUMN_MIN_WIDTH,
      cell: (policy) => (
        <DocumentCell
          policy={policy}
          open={shown.has(policyKey(policy))}
          onToggle={handleToggle}
          role={role.name}
          connection={connection}
        />
      ),
    },
  ];

  return (
    <SpaceBetween size="l">
      <SpaceBetween size="xs">
        <Table<PolicyRef>
          variant="container"
          items={items}
          trackBy={policyKey}
          columnDefinitions={columns}
          ariaLabels={{ tableLabel: 'Permissions policies' }}
          wrapLines
          header={<Header variant="h2">Permissions policies</Header>}
          empty={
            policies.kind === 'failed' ? (
              <ReadFailure state={readFailureState(policies.failure, connection, POLICIES_THING)} onRetry={onRetry} />
            ) : (
              <Box textAlign="center" color="inherit">
                <SpaceBetween size="xxs">
                  <Box variant="strong" color="inherit">
                    No policies
                  </Box>
                  <Box variant="p" color="inherit">
                    This role has no permissions policy in the emulator.
                  </Box>
                </SpaceBetween>
              </Box>
            )
          }
        />
        {policies.kind === 'read' && policies.truncated && (
          <Box variant="p" color="text-body-secondary">
            More policies exist than are shown.
          </Box>
        )}
      </SpaceBetween>
      <BoundarySection role={role} />
    </SpaceBetween>
  );
}
