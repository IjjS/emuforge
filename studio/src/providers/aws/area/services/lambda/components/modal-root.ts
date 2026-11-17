import { useCallback, useContext } from 'react';

import { AreaRootContext } from '../../../area-root';

/**
 * Cloudscape's modal root in the AWS area's root, never under `document.body`, for the Lambda screens' dialogs ("Delete
 * functions", "Preferences"). The two functions keep their identity for the life of the screen: Cloudscape's portal
 * asks for a new container each time they change, which would move an open dialog into a new element on every
 * render and remount what it holds, its field and its focus with it (decisions-needed 18, provisional).
 */
export function useAreaModalRoot(): {
  getModalRoot: () => Promise<HTMLElement>;
  removeModalRoot: (container: HTMLElement | null) => void;
} {
  const root = useContext(AreaRootContext);
  // Cloudscape asks for the root in the commit that mounts the dialog, where the area's root, an ancestor, may not
  // have its ref yet; it is looked up once that commit is done. Outside an area it rejects, and no dialog is rendered.
  const getModalRoot = useCallback(
    () =>
      Promise.resolve().then(() => {
        const area = root.current;
        if (area === null) {
          throw new Error('A modal of the AWS area opened outside the area.');
        }
        const container = document.createElement('div');
        area.appendChild(container);
        return container;
      }),
    [root],
  );
  const removeModalRoot = useCallback((container: HTMLElement | null) => {
    container?.remove();
  }, []);
  return { getModalRoot, removeModalRoot };
}
