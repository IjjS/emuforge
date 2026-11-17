import { useEffect } from 'react';

// The document title of a state of a page at the same address (issue 256, requirement R4.3: "Empty bucket", and
// "Empty bucket: Status" from the press of "Empty" on). The area reports a screen's title as a function of its path
// alone, so while `title` is given the screen's title at the start of the document title is replaced by it, and put
// back when `title` or the page goes. Provisional (`decisions-needed.md`, question 17): an area's own way for a page
// to name its title replaces it.

/**
 * While `title` is given, the document title reads `title` where it read `screenTitle`, the rest of it (Studio's own
 * suffix) unchanged. A document title that does not start with `screenTitle` is left as it is.
 */
export function useStatusTitle(screenTitle: string, title: string | undefined): void {
  useEffect(() => {
    if (title === undefined) {
      return undefined;
    }
    const before = document.title;
    if (!before.startsWith(screenTitle)) {
      return undefined;
    }
    const shown = `${title}${before.slice(screenTitle.length)}`;
    document.title = shown;
    return () => {
      // Only a title this hook wrote is put back: one the frame wrote since is the frame's.
      if (document.title === shown) {
        document.title = before;
      }
    };
  }, [screenTitle, title]);
}
