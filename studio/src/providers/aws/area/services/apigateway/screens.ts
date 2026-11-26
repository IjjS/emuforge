import type { ScreensFile, ServiceScreen } from '../../screens';

export const SCREENS: readonly ServiceScreen[] = Object.values(
  import.meta.glob<ScreensFile>('./screens/*.ts', { eager: true }),
).flatMap((file) => file.SCREENS);
