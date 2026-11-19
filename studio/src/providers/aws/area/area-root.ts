import { createContext, type RefObject } from 'react';

/** The AWS area's root element, for what the area renders outside its own tree (a `Modal`'s root). */
export const AreaRootContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });

/** The containers the area's modal root made in the area's root element, one per open dialog. */
const modalContainers = new WeakSet<Element>();

/** Makes the container of one open dialog of the area, as the area's modal root hands it to Cloudscape. */
export function createModalContainer(): HTMLDivElement {
  const container = document.createElement('div');
  modalContainers.add(container);
  return container;
}

/** Whether the area's root element holds a dialog's container: a dialog of the area is open. */
export function holdsModal(root: HTMLElement): boolean {
  return [...root.children].some((child) => modalContainers.has(child));
}
