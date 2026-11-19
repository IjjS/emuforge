import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { Ref } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { ValueText } from '../../../components/value-text';
import type { Role } from '../api';
import {
  descriptionText,
  isServiceLinked,
  lastActivityText,
  maxSessionDurationText,
  NO_VALUE,
  utcDateText,
} from '../format';

// Two sections of a role's page (issue 82, requirement R5.3): "Summary" with its "Edit" (R5.5), and "Permissions
// boundary", in the console's words; "Permissions policies" is the tab "Permissions"' own (issue 535,
// `permissions-tab.tsx`).
// Every value from the emulator is rendered as text, each as the kind of value it is, and the role's ARN and its
// boundary's with their copy control (issue 467, requirement R5, R6).

/**
 * The narrowest column of "Summary", in pixels: three columns where the page is wide, one at 390 wide, so the ARN has
 * the section's width to break in at its `:` and `/` (issue 467, requirement R6) rather than a third of it.
 */
const SUMMARY_COLUMN_MIN_WIDTH = 240;

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
          minColumnWidth={SUMMARY_COLUMN_MIN_WIDTH}
          items={[
            { label: 'Creation date', value: <ValueText kind="fixed" value={utcDateText(role.createDate)} /> },
            { label: 'ARN', value: <CopyValue label="ARN" value={role.arn} none={NO_VALUE} /> },
            { label: 'Last activity', value: <ValueText kind="fixed" value={lastActivityText(role.lastUsed)} /> },
            {
              label: 'Maximum session duration',
              value: <ValueText kind="fixed" value={maxSessionDurationText(role.maxSessionDuration)} />,
            },
            { label: 'Description', value: <ValueText kind="text" value={descriptionText(role.description)} /> },
            { label: 'Path', value: <ValueText kind="address" value={role.path} none={NO_VALUE} /> },
          ]}
        />
        {isServiceLinked(role.path) && <StatusIndicator type="info">Service-linked role</StatusIndicator>}
      </SpaceBetween>
    </Container>
  );
}

/** "Permissions boundary" (R5.3): the boundary's ARN as text with its copy control (issue 467, R5), or "Not set". */
export function BoundarySection({ role }: { role: Role }) {
  return (
    <Container header={<Header variant="h2">Permissions boundary</Header>}>
      <Box variant="p">
        <CopyValue label="Permissions boundary" value={role.permissionsBoundary} none="Not set" />
      </Box>
    </Container>
  );
}
