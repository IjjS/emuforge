import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { ValueText } from '../../../components/value-text';

// "Deletion protection" of a DB instance or a DB cluster (issue 573, requirement S3 and S6): "On" with, below it,
// the operation that changes it, which Studio has no screen for yet; or "Off".

export interface ProtectionValueProps {
  on: boolean;
  /** The operation that turns it off: `ModifyDBInstance`, `ModifyDBCluster`. */
  operation: string;
}

export function ProtectionValue({ on, operation }: ProtectionValueProps) {
  if (!on) {
    return <ValueText kind="fixed" value="Off" />;
  }
  return (
    <SpaceBetween size="xxs">
      <ValueText kind="fixed" value="On" />
      <Box variant="small">{`Changed with ${operation}.`}</Box>
    </SpaceBetween>
  );
}
