import './not-found-page.css';

import { Fragment, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router';

import { ButtonLink } from '../../ui/button-link';
import { PageHead } from '../../ui/page-head';

export const NOT_FOUND_TITLE = 'Page not found';

/**
 * While the path is wider than its box, the box is a named, focusable scroller, so a keyboard can scroll it; the
 * scroll shade at its edge shows that more lies beyond (DESIGN.md, Page not found).
 */
function useScrollerWhileOverflowing(box: RefObject<HTMLElement | null>, path: string): void {
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) {
      return;
    }
    const fit = () => {
      if (element.scrollWidth > element.clientWidth) {
        element.setAttribute('tabindex', '0');
        element.setAttribute('role', 'region');
        element.setAttribute('aria-label', 'Path');
      } else {
        element.removeAttribute('tabindex');
        element.removeAttribute('role');
        element.removeAttribute('aria-label');
      }
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(element);
    window.addEventListener('resize', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [box, path]);
}

/**
 * The requested path as text. Each segment is one unbreakable piece, and a break is allowed after each `/` only, so a
 * long path wraps between its segments and never inside one.
 */
function RequestedPath({ path }: { path: string }) {
  const box = useRef<HTMLElement>(null);
  useScrollerWhileOverflowing(box, path);
  return (
    <code ref={box}>
      {path.split('/').map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              /<wbr />
            </>
          )}
          <span>{segment}</span>
        </Fragment>
      ))}
    </code>
  );
}

/** The path as the user typed it: the router hands it percent-encoded (`%3Cimg%20…`). */
function decodedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/** Studio's "Page not found" (requirement R4.3): any path that is neither Home nor under a provider's segment. */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <div className="st-lost">
      <PageHead title={NOT_FOUND_TITLE} />
      <p className="st-lost-path">
        Studio has no page at <RequestedPath path={decodedPath(pathname)} />.
      </p>
      <ButtonLink to="/" primary>
        Go to Home
      </ButtonLink>
    </div>
  );
}
