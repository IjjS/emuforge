import type { ReactNode } from 'react';

import { ValueText } from '../../../components/value-text';

// A sentence of the Lambda screens that quotes a name (issue 467, requirement R6): a flash, "Function not found", the
// list's "No matches".

/**
 * A sentence that quotes a name: the name as a name, the words around it as free text. Its text is `before`, the name
 * and `after`, character for character.
 */
export function quoting(before: string, name: string, after: string): ReactNode {
  return (
    <>
      <ValueText kind="text" value={before} />
      <ValueText kind="name" value={name} />
      <ValueText kind="text" value={after} />
    </>
  );
}
