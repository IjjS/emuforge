import Box from '@cloudscape-design/components/box';
import { Fragment } from 'react';
import { useLocation } from 'react-router';

import { EmptyPage } from '../components/empty-page';

/**
 * The requested path as text. A break is allowed after each `/` only, so a long path wraps between its segments
 * and never inside one.
 */
function RequestedPath({ pathname }: { pathname: string }) {
  return (
    <Box variant="code">
      {pathname.split('/').map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              /<wbr />
            </>
          )}
          <span style={{ whiteSpace: 'nowrap' }}>{segment}</span>
        </Fragment>
      ))}
    </Box>
  );
}

/** Any path under `/aws/` that is neither the index nor a service: the area's own "Page not found". */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <EmptyPage title="Page not found">
      Studio has no page at <RequestedPath pathname={decodedPath(pathname)} />.
    </EmptyPage>
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
