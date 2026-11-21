import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { CopyValue } from '../../../components/copy-value';

type ComposeHostEndpointProps = {
  engine: string | undefined;
  port: number | undefined;
} & ({ kind: 'cluster' } | { kind: 'instance'; clusterId: string | undefined });

const LABEL = 'Compose host endpoint';

export function ComposeHostEndpoint(resource: ComposeHostEndpointProps) {
  const { engine, port } = resource;
  const aurora = engine === 'aurora-postgresql' || engine === 'aurora-mysql';
  const supported =
    resource.kind === 'cluster' || resource.clusterId
      ? aurora
      : engine === 'postgres' || engine === 'mysql' || engine === 'mariadb';

  if (!supported || port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return (
    <Box margin={{ bottom: 'l' }}>
      <SpaceBetween size="xxs">
        <Box variant="strong">{LABEL}</Box>
        <CopyValue label={LABEL} value={`127.0.0.1:${port}`} />
        <Box variant="p">
          If the emulator runs in Docker Compose with database ports published, run your SQL client on the machine
          running Compose.
        </Box>
      </SpaceBetween>
    </Box>
  );
}
