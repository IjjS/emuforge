import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { Role } from '../api';
import { decodeDocument, indentJson } from '../document-text';
import { isServiceLinked, NO_VALUE, trustedEntitiesText } from '../format';
import { EditTrustPolicyDialog } from './edit-trust-policy-dialog';
import { PolicyDocument } from './policy-document';

// The tab "Trust relationships" of a role's page (issue 535, task 1): "Trusted entities", as the role list's column
// writes them, and "Trust policy", the role's document from the page's one read, indented; no further call.
// "Edit trust policy" (task 4) opens its dialog with the document as shown; unavailable for a service-linked role,
// whose trust policy the emulator does not let be changed.

/** Why "Edit trust policy" is unavailable for a service-linked role (requirement, "EmuForge's own text"). */
export const SERVICE_LINKED_REASON =
  "The emulator does not let a service-linked role's policies or trust policy be changed.";

export interface TrustTabProps {
  role: Role;
  connection: AreaConnection;
  /**
   * Told whether "Edit trust policy" is open, so the page keeps the tab, and the typed text, through a failed read
   * of the role behind the dialog (issue 535, fix-s6).
   */
  onDialogOpen?: (open: boolean) => void;
}

/** The trust policy as it is shown: percent-decoded once, indented when it is JSON, as it came otherwise. */
function trustPolicyText(role: Role): string {
  return indentJson(decodeDocument(role.trustPolicy));
}

export function TrustTab({ role, connection, onDialogOpen }: TrustTabProps) {
  const text = trustPolicyText(role);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onDialogOpen?.(editing);
    // Unmounted with the dialog open (the tab left), the page no longer keeps it.
    return () => {
      onDialogOpen?.(false);
    };
  }, [editing, onDialogOpen]);
  const serviceLinked = isServiceLinked(role.path);
  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header variant="h2" description="Who may assume this role.">
            Trusted entities
          </Header>
        }
      >
        <Box variant="p">
          <ValueText kind="text" value={trustedEntitiesText(role.trustPolicy, role.path)} />
        </Box>
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <Button
                onClick={() => {
                  setEditing(true);
                }}
                {...(serviceLinked && { disabled: true, disabledReason: SERVICE_LINKED_REASON })}
              >
                Edit trust policy
              </Button>
            }
          >
            Trust policy
          </Header>
        }
      >
        {text === '' ? (
          <Box variant="p">
            <ValueText kind="fixed" value={NO_VALUE} />
          </Box>
        ) : (
          <PolicyDocument source={{ kind: 'text', text }} connection={connection} />
        )}
      </Container>
      {editing && (
        <EditTrustPolicyDialog
          role={role.name}
          document={text}
          engineOrigin={connection.engineOrigin}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </SpaceBetween>
  );
}
