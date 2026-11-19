import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { Role, RolePolicies } from '../api';
import { isServiceLinked, policyPath, policyTypeText, type PolicyRef } from '../format';
import { useInlinePolicyDocument, useManagedPolicyDocument } from '../queries';
import { AttachPoliciesDialog } from './attach-policies-dialog';
import { DeleteInlinePolicyDialog } from './delete-inline-policy-dialog';
import { DetachPolicyDialog } from './detach-policy-dialog';
import { readFailureState } from './failures';
import { InlinePolicyDialog } from './inline-policy-dialog';
import { NAME_COLUMN_MIN_WIDTH } from './page-parts';
import { PolicyDocument } from './policy-document';
import { BoundarySection } from './role-sections';
import { ReadFailure } from './states';

// The tab "Permissions" of a role's page (issue 535, task 1): "Permissions policies", each policy's document shown in
// place on its row's "Show document", then "Permissions boundary" as on `main`. A managed policy's name leads to its
// own page by its ARN; an inline policy's is text. The changes of task 3 act from the table's header: "Attach
// policies" and "Add inline policy", and, for the chosen row, "Detach" (a managed policy), "Edit" and "Delete" (an
// inline one). For a service-linked role the five are unavailable with the reason; the emulator refuses them.
// Every change, done or refused, reads the role again (the hooks invalidate it), so the page follows the emulator.

/** What a failed policy list names (R10.1). */
const POLICIES_THING = 'policies';

/** The narrowest the document's column gets, in pixels, so a document has room to be read in its row. */
const DOCUMENT_COLUMN_MIN_WIDTH = 360;

/** The reason on each change a service-linked role cannot have (requirement, "EmuForge's own text"). */
const SERVICE_LINKED_REASON = "The emulator does not let a service-linked role's policies or trust policy be changed.";
const INLINE_NOT_DETACHED = 'An inline policy is deleted, not detached.';
const MANAGED_ELSEWHERE = 'A managed policy is changed on its own page.';

/** The dialog open on the tab, with what it acts on. */
type Dialog =
  | { kind: 'attach' }
  | { kind: 'add' }
  | { kind: 'detach'; policy: { name: string; arn: string } }
  | { kind: 'edit'; name: string }
  | { kind: 'delete'; name: string };

/** A button's state: available, or unavailable with its reason (none while no row is chosen). */
function availability(reason: string | undefined | false): Pick<ButtonProps, 'disabled' | 'disabledReason'> {
  if (reason === false) {
    return { disabled: false };
  }
  return reason === undefined ? { disabled: true } : { disabled: true, disabledReason: reason };
}

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
  const linked = isServiceLinked(role.path);
  const [chosenKey, setChosenKey] = useState<string>();
  // The chosen row, while the role's read still lists it.
  const chosen = items.find((policy) => policyKey(policy) === chosenKey);
  const [dialog, setDialog] = useState<Dialog>();
  // The control that opened the dialog, which has focus again once it closes.
  const openerRef = useRef<HTMLElement | null>(null);
  const open = (next: Dialog) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(next);
  };
  const handleClose = useCallback(() => {
    setDialog(undefined);
    openerRef.current?.focus();
  }, []);

  const attachedArns = new Set(items.flatMap((policy) => (policy.kind === 'managed' ? [policy.arn] : [])));
  const inlineNames = items.flatMap((policy) => (policy.kind === 'inline' ? [policy.name] : []));

  // Each action's reason when unavailable; `false` when available.
  const forRole = linked ? SERVICE_LINKED_REASON : false;
  const detachReason = linked
    ? SERVICE_LINKED_REASON
    : chosen === undefined
      ? undefined
      : chosen.kind === 'inline'
        ? INLINE_NOT_DETACHED
        : false;
  const inlineReason = linked
    ? SERVICE_LINKED_REASON
    : chosen === undefined
      ? undefined
      : chosen.kind === 'managed'
        ? MANAGED_ELSEWHERE
        : false;

  const actions = (
    <SpaceBetween direction="horizontal" size="xs">
      <Button
        {...availability(detachReason)}
        onClick={() => {
          if (chosen?.kind === 'managed') {
            open({ kind: 'detach', policy: { name: chosen.name, arn: chosen.arn } });
          }
        }}
      >
        Detach
      </Button>
      <Button
        ariaLabel="Edit inline policy"
        {...availability(inlineReason)}
        onClick={() => {
          if (chosen?.kind === 'inline') {
            open({ kind: 'edit', name: chosen.name });
          }
        }}
      >
        Edit
      </Button>
      <Button
        ariaLabel="Delete inline policy"
        {...availability(inlineReason)}
        onClick={() => {
          if (chosen?.kind === 'inline') {
            open({ kind: 'delete', name: chosen.name });
          }
        }}
      >
        Delete
      </Button>
      <Button
        {...availability(forRole)}
        onClick={() => {
          open({ kind: 'add' });
        }}
      >
        Add inline policy
      </Button>
      <Button
        variant="primary"
        {...availability(forRole)}
        onClick={() => {
          open({ kind: 'attach' });
        }}
      >
        Attach policies
      </Button>
    </SpaceBetween>
  );

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
          selectionType="single"
          selectedItems={chosen === undefined ? [] : [chosen]}
          onSelectionChange={({ detail }) => {
            const [first] = detail.selectedItems;
            setChosenKey(first === undefined ? undefined : policyKey(first));
          }}
          ariaLabels={{
            tableLabel: 'Permissions policies',
            selectionGroupLabel: 'Policy selection',
            itemSelectionLabel: (_, policy) => policy.name,
          }}
          wrapLines
          header={
            <Header variant="h2" actions={actions}>
              Permissions policies
            </Header>
          }
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
      {dialog?.kind === 'attach' && (
        <AttachPoliciesDialog role={role.name} attached={attachedArns} connection={connection} onClose={handleClose} />
      )}
      {dialog?.kind === 'add' && (
        <InlinePolicyDialog
          role={role.name}
          mode={{ kind: 'add', held: inlineNames }}
          connection={connection}
          onClose={handleClose}
        />
      )}
      {dialog?.kind === 'edit' && (
        <InlinePolicyDialog
          role={role.name}
          mode={{ kind: 'edit', name: dialog.name }}
          connection={connection}
          onClose={handleClose}
        />
      )}
      {dialog?.kind === 'detach' && (
        <DetachPolicyDialog
          role={role.name}
          policy={dialog.policy}
          engineOrigin={connection.engineOrigin}
          onClose={handleClose}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteInlinePolicyDialog
          role={role.name}
          name={dialog.name}
          engineOrigin={connection.engineOrigin}
          onClose={handleClose}
        />
      )}
    </SpaceBetween>
  );
}
