import '../styles/content-target.css';

import { useId, useLayoutEffect, type ReactNode, type RefObject } from 'react';

interface ContentTargetProps {
  /** The target, for the area to focus. */
  targetRef: RefObject<HTMLElement | null>;
  /** The emulator line, then the page's content with its `h1`. */
  children: ReactNode;
}

/**
 * The area's content target (form (b) of the content target, as Studio's provider contract asks): a region inside
 * `AppLayout`'s content, past the side navigation and the breadcrumbs, that holds the emulator line, then the page's
 * `h1` and its controls, and is named by the `h1` (issue 45, R4.8): what is read first after focus lands on it is
 * "Local emulator, not AWS" and its status. It takes focus from script only, never from Tab, and draws no ring. Cloudscape's `Header`
 * gives its `h1` no id, so the region gives it one to be named by; an id the `h1` already has is kept and used.
 */
export function ContentTarget({ targetRef, children }: ContentTargetProps) {
  const headingId = useId();
  // Before the page is painted, on every render: the region is named by its `h1`, under the id the `h1` has.
  useLayoutEffect(() => {
    const region = targetRef.current;
    const heading = region?.querySelector('h1');
    if (region == null || heading == null) {
      return;
    }
    if (heading.id === '') {
      heading.id = headingId;
    }
    region.setAttribute('aria-labelledby', heading.id);
  });
  return (
    <section ref={targetRef} className="aws-area-content" tabIndex={-1}>
      {children}
    </section>
  );
}
