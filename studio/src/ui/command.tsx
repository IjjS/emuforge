import './command.css';

import type { ReactNode } from 'react';

interface CommandProps {
  /** What the command does, on the line above it. */
  label: ReactNode;
  /** A short name for the command: the group is "Command: <name>". */
  name: string;
  /** The command exactly as shown, lines separated by `\n`. */
  command: string;
  /** The control at the label line's end (its "Copy" button). */
  control: ReactNode;
}

/** A command to read and copy: a group with the step label and its control on one line, the command in a `pre`. */
export function Command({ label, name, command, control }: CommandProps) {
  return (
    <div className="st-cmd" role="group" aria-label={`Command: ${name}`}>
      <div className="st-cmd-label">
        <span>{label}</span>
        {control}
      </div>
      <pre>{command}</pre>
    </div>
  );
}

/** The steps of a notice, one width for all, so every control sits at its command's right edge. */
export function Steps({ children }: { children: ReactNode }) {
  return <div className="st-steps">{children}</div>;
}

/** Code inside a sentence: the code font on `sunk`, never broken. */
export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="st-code">{children}</code>;
}
