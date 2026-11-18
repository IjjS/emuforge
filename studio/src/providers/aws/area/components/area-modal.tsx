import Modal, { type ModalProps } from '@cloudscape-design/components/modal';
import { useContext, useMemo } from 'react';

import { AreaRootContext } from '../area-root';

export type AreaModalProps = Omit<ModalProps, 'modalRoot' | 'getModalRoot' | 'removeModalRoot'>;

/** The AWS area's modal root, as Cloudscape's components that open a modal of their own take it. */
export interface AreaModalRoot {
  getModalRoot: () => Promise<HTMLElement>;
  removeModalRoot: (container: HTMLElement | null) => void;
}

/**
 * Cloudscape's `Modal`, rendered into the AWS area's root element instead of `document.body`, so no Cloudscape
 * element is ever rendered outside the area. Every modal of the area is this one.
 *
 * It is mounted only while it is open, as Cloudscape's own `CollectionPreferences` mounts its modal: closed, nothing of
 * it is in the area's root, and each opening starts from what its content renders. Cloudscape gives focus back to what
 * opened it, and the page its scrolling, when an open `Modal` unmounts as when it is hidden.
 */
export function AreaModal(props: AreaModalProps) {
  const modalRoot = useAreaModalRoot();
  return props.visible ? <Modal {...props} {...modalRoot} /> : null;
}

/**
 * The AWS area's modal root, for a Cloudscape component that opens a modal of its own (`CollectionPreferences`):
 * spread it into the component, as `AreaModal` does. Each open modal gets a container of its own in the area's root,
 * never under `document.body`, and the container is removed when the modal goes.
 *
 * Both functions keep their identity for as long as the component that holds them is mounted: Cloudscape's portal
 * makes a new container, and renders the modal's content into it afresh, whenever either changes, which would take an
 * open dialog apart on every re-render (a key typed, a button turned to loading, the connection check's answer) and
 * drop its focus and what was typed into it.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the area's one modal root sits beside the one modal that uses it
export function useAreaModalRoot(): AreaModalRoot {
  const root = useContext(AreaRootContext);
  return useMemo(
    () => ({
      // Cloudscape asks for the root in the commit that mounts the modal, where the area's root, an ancestor, may not
      // have its ref yet; it is looked up once that commit is done. Outside an area it rejects: Cloudscape's portal
      // catches that, logs "[AwsUi] [portal]: failed to load portal root" and renders no modal, rather than one under
      // `document.body`.
      getModalRoot: () =>
        Promise.resolve().then(() => {
          const area = root.current;
          if (area === null) {
            throw new Error('A modal of the AWS area opened outside the area.');
          }
          const container = document.createElement('div');
          area.appendChild(container);
          return container;
        }),
      removeModalRoot,
    }),
    [root],
  );
}

function removeModalRoot(container: HTMLElement | null): void {
  container?.remove();
}
