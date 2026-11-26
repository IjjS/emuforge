import { describe, expect, it } from 'vitest';

import { findResourceEntry } from '../../entries';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

describe("S3's screen navigation (issue 650)", () => {
  it('marks General purpose buckets current on every screen', () => {
    for (const screen of SCREENS) {
      const { activeHref } = screen.navigation;
      expect(activeHref, screen.paths[0]).toBe('/aws/s3/buckets');
      expect(findResourceEntry(ENTRIES, activeHref)?.label, screen.paths[0]).toBe('General purpose buckets');
    }
  });

  it('leaves the items to the entry registry', () => {
    for (const screen of SCREENS) {
      expect(screen.navigation.items, screen.paths[0]).toBeUndefined();
    }
  });
});
