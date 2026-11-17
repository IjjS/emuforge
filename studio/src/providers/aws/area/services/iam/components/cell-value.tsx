import type { ReactNode } from 'react';

import './cell-value.css';

/**
 * A value from the emulator in a table cell of the IAM screens (a role's name, its trusted entities), breaking
 * anywhere when it must: with "Wrap lines" on, a word without a space stays in its cell (issue 82).
 */
export function CellValue({ children }: { children: ReactNode }) {
  return <span className="aws-iam-cell-value">{children}</span>;
}
