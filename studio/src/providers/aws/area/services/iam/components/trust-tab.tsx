import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';

import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { Role } from '../api';
import { decodeDocument, indentJson } from '../document-text';
import { NO_VALUE, trustedEntitiesText } from '../format';
import { PolicyDocument } from './policy-document';

// The tab "Trust relationships" of a role's page (issue 535, task 1): "Trusted entities", as the role list's column
// writes them, and "Trust policy", the role's document from the page's one read, indented; no further call.
// Read-only here; issue 535's s4 adds its edit.

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
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Trusted entities</Header>}>
        <Box variant="p">
          <ValueText kind="text" value={trustedEntitiesText(role.trustPolicy, role.path)} />
        </Box>
      </Container>
      <Container header={<Header variant="h2">Trust policy</Header>}>
        {text === '' ? (
          <Box variant="p">
            <ValueText kind="fixed" value={NO_VALUE} />
          </Box>
        ) : (
          <PolicyDocument source={{ kind: 'text', text }} connection={connection} />
        )}
      </Container>
    </SpaceBetween>
  );
}
