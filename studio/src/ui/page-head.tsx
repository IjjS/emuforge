import './page.css';

import type { ReactNode } from 'react';

interface PageHeadProps {
  /** The page's `h1`; also the page's part of the document title. */
  title: string;
  /** One line under the title. */
  description?: ReactNode;
  /** The page's actions, at the head's end. */
  actions?: ReactNode;
}

/** The head of a page of Studio's own layer: its `h1`, a description and its actions. */
export function PageHead({ title, description, actions }: PageHeadProps) {
  return (
    <div className="st-head">
      <div>
        <h1>{title}</h1>
        {description !== undefined && <p>{description}</p>}
      </div>
      {actions}
    </div>
  );
}
