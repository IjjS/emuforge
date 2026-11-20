import { describe, expect, it } from 'vitest';

import { launchFormMessages } from './launch-form';

describe("S2's checks", () => {
  it('no image → "Choose an image."; no type → "Choose an instance type."; both chosen → none', () => {
    expect(launchFormMessages({ name: '', imageChosen: false, typeChosen: true })).toEqual({
      image: 'Choose an image.',
    });
    expect(launchFormMessages({ name: '', imageChosen: true, typeChosen: false })).toEqual({
      type: 'Choose an instance type.',
    });
    expect(launchFormMessages({ name: '', imageChosen: false, typeChosen: false })).toEqual({
      image: 'Choose an image.',
      type: 'Choose an instance type.',
    });
    expect(launchFormMessages({ name: '', imageChosen: true, typeChosen: true })).toEqual({});
  });

  it('a name of 257 characters → "A name can have up to 256 characters."; 256 and empty → none', () => {
    const chosen = { imageChosen: true, typeChosen: true };
    expect(launchFormMessages({ name: 'n'.repeat(257), ...chosen })).toEqual({
      name: 'A name can have up to 256 characters.',
    });
    expect(launchFormMessages({ name: 'n'.repeat(256), ...chosen })).toEqual({});
    expect(launchFormMessages({ name: '', ...chosen })).toEqual({});
  });
});
