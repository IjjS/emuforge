import { createContext, useContext, useLayoutEffect } from 'react';

/** What a page of the area shows of the emulator: resources, under the plural word the page gives for them. */
export interface PageResources {
  /** The page's own plural word for them ("buckets"); `undefined` when it gives none ("resources"). */
  word: string | undefined;
}

/**
 * Where a page of the area names its resources: the area's frame, which then carries the local-emulator notice under
 * the emulator line and the (i) control at the line's end (requirement R5). `null` once the page is gone. Outside the
 * frame nothing listens.
 */
export const PageResourcesContext = createContext<(resources: PageResources | null) => void>(() => undefined);

/**
 * Called by a page of the area that shows resources of the emulator, with its plural word for them, if it has one
 * (R5.1). The page names them before it is painted, so the notice and the (i) control are there on its first paint;
 * a page that does not call it shows no resources and carries neither (R5.5).
 */
export function useShowsResources(word?: string): void {
  const name = useContext(PageResourcesContext);
  useLayoutEffect(() => {
    name({ word });
    return () => {
      name(null);
    };
  }, [name, word]);
}
