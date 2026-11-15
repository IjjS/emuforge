import '../styles/content-target.css';

import { useId, useLayoutEffect, type ReactNode, type RefObject } from 'react';

interface ContentTargetProps {
  /** The target, for the area to focus. */
  targetRef: RefObject<HTMLElement | null>;
  /** The page's content, its `h1` first. */
  children: ReactNode;
}

/**
 * The area's content target (form (b) of the content target, as Studio's provider contract asks): a region inside
 * `AppLayout`'s content, past the side navigation and the breadcrumbs, that holds the page's `h1` and its controls
 * and is named by the `h1`. It takes focus from script only, never from Tab, and draws no ring. Cloudscape's `Header`
 * gives its `h1` no id, so the region gives it one to be named by.
 */
export function ContentTarget({ targetRef, children }: ContentTargetProps) {
  const headingId = useId();
  useLayoutEffect(() => {
    const heading = targetRef.current?.querySelector('h1');
    if (heading != null && heading.id !== headingId) {
      heading.id = headingId;
    }
  });
  return (
    <section ref={targetRef} className="aws-area-content" tabIndex={-1} aria-labelledby={headingId}>
      {children}
    </section>
  );
}
