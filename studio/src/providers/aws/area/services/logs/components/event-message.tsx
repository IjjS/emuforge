import Box from '@cloudscape-design/components/box';

import { ValueText } from '../../../components/value-text';

export function EventMessage({ message }: { message: string | undefined }) {
  return (
    <Box variant="pre" margin={{ top: 'n', bottom: 'n' }} nativeAttributes={{ style: { whiteSpace: 'pre-wrap' } }}>
      <ValueText kind="text" value={message} />
    </Box>
  );
}
