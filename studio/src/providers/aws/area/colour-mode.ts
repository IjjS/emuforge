import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { useLayoutEffect, type RefObject } from 'react';

/**
 * Cloudscape's mode on the area's root element only: `awsui-dark-mode` there exactly while the operating system's
 * colour scheme is dark, changing with it while the area is open. `html` and `body` are never touched; nothing is
 * stored and there is no toggle.
 */
export function useColourMode(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) {
      return;
    }
    const dark = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      applyMode(dark.matches ? Mode.Dark : Mode.Light, element);
    };
    apply();
    dark.addEventListener('change', apply);
    return () => {
      dark.removeEventListener('change', apply);
    };
  }, [root]);
}
