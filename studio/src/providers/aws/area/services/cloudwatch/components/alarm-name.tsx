import Box from '@cloudscape-design/components/box';

import { CopyValue } from '../../../components/copy-value';
import { ValueText } from '../../../components/value-text';

export function AlarmName({ name, copy = false }: { name: string; copy?: boolean }) {
  return (
    <Box variant="span" nativeAttributes={{ style: { whiteSpace: 'pre-wrap' } }}>
      {copy ? <CopyValue label="Name" value={name} kind="name" /> : <ValueText kind="name" value={name} />}
    </Box>
  );
}
