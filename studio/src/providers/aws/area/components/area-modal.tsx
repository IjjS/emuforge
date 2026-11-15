import Modal, { type ModalProps } from '@cloudscape-design/components/modal';
import { useContext } from 'react';

import { AreaRootContext } from '../area-root';

export type AreaModalProps = Omit<ModalProps, 'modalRoot' | 'getModalRoot' | 'removeModalRoot'>;

/**
 * Cloudscape's `Modal`, rendered into the AWS area's root element instead of `document.body`, so no Cloudscape
 * element is ever rendered outside the area. Every modal of the area is this one.
 */
export function AreaModal(props: AreaModalProps) {
  const root = useContext(AreaRootContext);
  // Cloudscape asks for the root in the commit that mounts the modal, where the area's root, an ancestor, may not
  // have its ref yet; it is looked up once that commit is done.
  const getModalRoot = () =>
    Promise.resolve().then(() => {
      const area = root.current;
      if (area === null) {
        throw new Error('A modal of the AWS area opened outside the area.');
      }
      const container = document.createElement('div');
      area.appendChild(container);
      return container;
    });
  return <Modal {...props} getModalRoot={getModalRoot} removeModalRoot={removeModalRoot} />;
}

function removeModalRoot(container: HTMLElement | null): void {
  container?.remove();
}
