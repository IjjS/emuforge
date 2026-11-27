import type { ServiceScreen, ScreensFile } from '../../screens';

export const SCREENS: readonly ServiceScreen[] = Object.values(
  import.meta.glob<ScreensFile>(['./screens/*.ts', '!./screens/*.test.ts'], { eager: true }),
).flatMap(({ SCREENS: screens }) => screens);
