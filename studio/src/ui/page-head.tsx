import './page.css';

import type { ReactNode } from 'react';

/**
 * The id of the page's `h1`. A page of Studio's own layer has one head, and its `main` is named by that `h1` (its
 * content target, which "Skip to content" and a route change focus).
 */
export const PAGE_TITLE_ID = 'page-title';

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
        <h1 id={PAGE_TITLE_ID}>{title}</h1>
        {description !== undefined && <p>{description}</p>}
      </div>
      {actions}
    </div>
  );
}
