import './button.css';

import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface ButtonLinkProps {
  /** A path inside Studio; followed with the router, so the page is not loaded again. */
  to: string;
  /** The page's one primary action draws in the accent colour (DESIGN.md, Buttons). */
  primary?: boolean;
  children: ReactNode;
}

/** A link that reads as a button: Studio's way to another page, such as "Go to Home". */
export function ButtonLink({ to, primary = false, children }: ButtonLinkProps) {
  return (
    <Link className={primary ? 'st-btn primary' : 'st-btn'} to={to}>
      {children}
    </Link>
  );
}
