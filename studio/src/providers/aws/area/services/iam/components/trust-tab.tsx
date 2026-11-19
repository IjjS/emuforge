import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

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
}

/** The trust policy as it is shown: percent-decoded once, indented when it is JSON, as it came otherwise. */
function trustPolicyText(role: Role): string {
  return indentJson(decodeDocument(role.trustPolicy));
}

export function TrustTab({ role, connection }: TrustTabProps) {
  const text = trustPolicyText(role);
  const [editing, setEditing] = useState(false);
  const serviceLinked = isServiceLinked(role.path);
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Trusted entities</Header>}>
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
