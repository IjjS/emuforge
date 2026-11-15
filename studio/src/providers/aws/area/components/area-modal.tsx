import Modal, { type ModalProps } from '@cloudscape-design/components/modal';
import { useCallback, useContext } from 'react';

import { AreaRootContext } from '../area-root';

export type AreaModalProps = Omit<ModalProps, 'modalRoot' | 'getModalRoot' | 'removeModalRoot'>;

/**
 * Cloudscape's `Modal`, rendered into the AWS area's root element instead of `document.body`, so no Cloudscape
 * element is ever rendered outside the area. Every modal of the area is this one.
 */
export function AreaModal(props: AreaModalProps) {
  const root = useContext(AreaRootContext);
  const getModalRoot = useCallback(() => {
    const area = root.current;
    if (area === null) {
      return Promise.reject(new Error('A modal of the AWS area opened outside the area.'));
    }
    const container = document.createElement('div');
    area.appendChild(container);
    return Promise.resolve(container);
  }, [root]);
  return <Modal {...props} getModalRoot={getModalRoot} removeModalRoot={removeModalRoot} />;
}

function removeModalRoot(container: HTMLElement): void {
  container.remove();
}
