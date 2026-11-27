import './name-text.css';

import type { ReactNode } from 'react';

import { holdsHiddenWhiteSpace, nameIdentity } from './name-identity';
import { ValueText } from './value-text';

interface NameTextProps {
  name: string | null | undefined;
  /** The text to draw when the name's line terminators have been prepared for display. */
  display?: string | undefined;
  none?: ReactNode;
}

/** Draw the name and give links, headings and dialog headers its exact accessible identity. */
export function NameText({ name, display, none }: NameTextProps) {
  if (!name) return <>{none}</>;
  const identity = nameIdentity(name);
  const drawn = <ValueText kind="name" value={display ?? name} />;
  if (name === identity) return drawn;

  return (
    <>
      <span aria-hidden="true">
        {drawn}
        {holdsHiddenWhiteSpace(name) && (
          <>
            {' '}
            <ValueText kind="name" value={`(${identity})`} />
          </>
        )}
      </span>
      <span className="aws-area-name-identity">{identity}</span>
    </>
  );
}
