import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { ReactNode, Ref } from 'react';

import './role-sections.css';
import type { AreaConnection } from '../../../components/emulator-line';
import type { Role, RolePolicies } from '../api';
import {
  descriptionText,
  isServiceLinked,
  lastActivityText,
  maxSessionDurationText,
  NO_VALUE,
  policyTypeText,
  utcDateText,
  type PolicyRef,
} from '../format';
import { readFailureState } from './failures';
import { ReadFailure } from './states';

// The three sections of a role's page (issue 82, requirement R5.3): "Summary" with its "Edit" (R5.5), "Permissions
// policies" and "Permissions boundary", in the console's words; their empty and failure texts in EmuForge's own.
// Every value from the emulator is rendered as text.

/** What a failed policy list names (R10.1). */
const POLICIES_THING = 'policies';

/** A value from the emulator as text that breaks anywhere when it must (R11): a word without a space stays in its box. */
export function Value({ children }: { children: ReactNode }) {
  return <span className="aws-iam-value">{children}</span>;
}

export interface SummarySectionProps {
  role: Role;
  /** "Edit" in the section's header, which opens "Edit summary". */
  onEdit: () => void;
  editRef: Ref<ButtonProps.Ref>;
}

/** "Summary" (R5.3): the six pairs in order, and "Service-linked role" under them for such a role. */
export function SummarySection({ role, onEdit, editRef }: SummarySectionProps) {
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button ref={editRef} onClick={onEdit}>
              Edit
            </Button>
          }
        >
          Summary
        </Header>
      }
    >
      <SpaceBetween size="m">
        <KeyValuePairs
          columns={3}
          items={[
            { label: 'Creation date', value: <Value>{utcDateText(role.createDate)}</Value> },
            { label: 'ARN', value: <Value>{role.arn ?? NO_VALUE}</Value> },
            { label: 'Last activity', value: lastActivityText(role.lastUsed) },
            { label: 'Maximum session duration', value: maxSessionDurationText(role.maxSessionDuration) },
            { label: 'Description', value: <Value>{descriptionText(role.description)}</Value> },
            { label: 'Path', value: <Value>{role.path ?? NO_VALUE}</Value> },
          ]}
        />
        {isServiceLinked(role.path) && <StatusIndicator type="info">Service-linked role</StatusIndicator>}
      </SpaceBetween>
    </Container>
  );
}

const POLICY_COLUMNS: TableProps.ColumnDefinition<PolicyRef>[] = [
  { id: 'name', header: 'Policy name', isRowHeader: true, cell: (policy) => <Value>{policy.name}</Value> },
  { id: 'type', header: 'Type', cell: (policy) => policyTypeText(policy) },
];

export interface PoliciesSectionProps {
  policies: RolePolicies;
  connection: AreaConnection;
  /** "Retry" of a failed list: reads the role again. */
  onRetry: () => void;
}

/**
 * "Permissions policies" (R5.3): the attached policies, then the inline ones; no row is a link and nothing is
 * selectable. A failed list shows its state in the table's place, the table's heading and columns kept (R10.1).
 */
export function PoliciesSection({ policies, connection, onRetry }: PoliciesSectionProps) {
  const items = policies.kind === 'read' ? policies.items : [];
  return (
    <SpaceBetween size="xs">
      <Table<PolicyRef>
        variant="container"
        items={items}
        trackBy={(policy) => `${policy.kind}:${policy.kind === 'managed' ? policy.arn : policy.name}`}
        columnDefinitions={POLICY_COLUMNS}
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
  );
}

/** "Permissions boundary" (R5.3): the boundary's ARN as text, or "Not set". */
export function BoundarySection({ role }: { role: Role }) {
  return (
    <Container header={<Header variant="h2">Permissions boundary</Header>}>
      <Box variant="p">
        <Value>{role.permissionsBoundary ?? 'Not set'}</Value>
      </Box>
    </Container>
  );
}
