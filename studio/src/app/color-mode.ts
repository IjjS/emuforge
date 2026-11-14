import { applyMode, Mode } from '@cloudscape-design/global-styles';

/**
 * Light and dark follow the operating system's colour scheme through Cloudscape's mode, and change with it while
 * the page is open. Nothing is stored in the browser; there is no toggle.
 */
export function followColorScheme(): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    applyMode(dark.matches ? Mode.Dark : Mode.Light);
  };
  apply();
  dark.addEventListener('change', apply);
}
