import { useCallback } from 'react';
import { useNavigate } from 'react-router';

interface FollowDetail {
  href?: string | undefined;
  external?: boolean | undefined;
}

/**
 * The `onFollow` handler for a Cloudscape link, button, breadcrumb or navigation item with an `href` inside Studio:
 * it moves with the router instead of loading the page again. Cloudscape fires `onFollow` only for a plain click or
 * Enter, so a click with a modifier key still opens a new tab.
 */
export function useFollow(): (event: CustomEvent<FollowDetail>) => void {
  const navigate = useNavigate();
  return useCallback(
    (event: CustomEvent<FollowDetail>) => {
      const href = event.detail.href;
      if (href === undefined || event.detail.external === true || !href.startsWith('/')) {
        return;
      }
      event.preventDefault();
      void navigate(href);
    },
    [navigate],
  );
}
