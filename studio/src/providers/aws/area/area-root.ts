import { createContext, type RefObject } from 'react';

/** The AWS area's root element, for what the area renders outside its own tree (a `Modal`'s root). */
export const AreaRootContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });
