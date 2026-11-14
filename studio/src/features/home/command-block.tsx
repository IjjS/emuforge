import CodeView from '@cloudscape-design/code-view/code-view';
import Box from '@cloudscape-design/components/box';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

interface CommandBlockProps {
  /** What the command does, shown above it. */
  label: ReactNode;
  /** A short name for the command in the copy button's and the code's accessible names. */
  name: string;
  /** The command exactly as shown and copied. */
  command: string;
}

// The label and the copy button share one row, so the button never covers the code.
const labelRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as const;

/** One command to copy: its label, a copy button, and the command as code. */
export function CommandBlock({ label, name, command }: CommandBlockProps) {
  return (
    <SpaceBetween size="xxs">
      <div style={labelRow}>
        <Box variant="span" fontWeight="bold">
          {label}
        </Box>
        <CopyToClipboard
          variant="icon"
          textToCopy={command}
          copyButtonAriaLabel={`Copy command: ${name}`}
          copySuccessText="Command copied"
          copyErrorText="Command not copied"
        />
      </div>
      <CodeView content={command} wrapLines ariaLabel={`Command: ${name}`} />
    </SpaceBetween>
  );
}
