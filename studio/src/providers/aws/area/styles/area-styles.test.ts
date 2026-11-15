// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { staleAreaStyles } from '../../../../../scripts/aws-area-styles.ts';

describe("the AWS area's scoped Cloudscape styles", () => {
  it('are what scripts/aws-area-styles.ts generates from the installed Cloudscape packages', async () => {
    expect(await staleAreaStyles()).toEqual([]);
  });
});
