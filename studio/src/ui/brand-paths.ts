// EmuForge's marks as data (requirement R4, R5.2): the symbol path, the tile path, where the tile path sits on its
// square, and the code sign. `scripts/brand.ts` writes every brand file from these values, and the frame's tile
// draws the same tile path, so every mark has one geometry.
//
// Both paths are absolute `M`, `L`, `C` and `Z` commands with at most two decimals, filled `evenodd`: the first
// subpath is the silhouette, the second the eye, which is a hole. The tile path is the symbol path with its neck
// continued down to below the square's bottom edge, where the square clips it; every segment from the crest round
// to the beak, under the beak to the throat, and the eye are the symbol path's, unchanged.

/** The head and neck of an emu in profile, facing right (R4.1): `studio/brand/symbol.svg`'s one path. */
export const SYMBOL_PATH =
  'M 160.1 46.8 L 128.2 32.8 C 124 29.5 118 21.5 113.4 15.2 C 110 11 106 7.5 102.6 5.5 L 103.6 12.9 ' +
  'C 97 7.5 85 1.5 70 0.3 C 73.5 3.5 78 9.5 80.2 13.6 C 70 10.5 57 10 44.8 15.2 C 51 17 58.5 19.3 62.9 22.1 ' +
  'C 50 26 39 33 33.5 43.2 C 39 42 45 40 50.2 39.9 C 44 48.5 39 58 36.4 64.1 C 31 77 26.5 95 22.7 104.6 ' +
  'C 18.5 115.5 11 128.5 0 139.8 L 47 140 C 53.5 140 56.8 134.5 58.6 127.8 C 61 115.5 63.5 101 65.8 90.2 ' +
  'C 68 80.5 72 72.5 82.6 67.8 C 92 63.8 107 60 126.8 57.5 L 161.1 57.8 C 165 57.8 167 55.5 165.5 52.5 ' +
  'C 164.3 50 162.5 48.3 160.1 46.8 Z ' +
  'M 94.6 37.5 C 95 33.5 99.5 31 105 31 C 111 31 116.5 34.5 117 38 C 116.3 41.5 111.5 45 104.5 45 ' +
  'C 99 45 94.8 41.5 94.6 37.5 Z';

/**
 * The symbol on the tile (R4.2): the same head, the neck continued along its lean, down and to the left, past the
 * square's bottom edge. The neck narrows toward the edge so the mark keeps its eye at 16 pixels.
 */
export const TILE_PATH =
  'M 160.1 46.8 L 128.2 32.8 C 124 29.5 118 21.5 113.4 15.2 C 110 11 106 7.5 102.6 5.5 L 103.6 12.9 ' +
  'C 97 7.5 85 1.5 70 0.3 C 73.5 3.5 78 9.5 80.2 13.6 C 70 10.5 57 10 44.8 15.2 C 51 17 58.5 19.3 62.9 22.1 ' +
  'C 50 26 39 33 33.5 43.2 C 39 42 45 40 50.2 39.9 C 44 48.5 39 58 36.4 64.1 C 32 76 24 100 18 128 ' +
  'C 13.5 151 9 175 6 196 L 39 196 C 42 176 48 150 54.5 125 C 59 109 63.5 99 65.8 90.2 ' +
  'C 68 80.5 72 72.5 82.6 67.8 C 92 63.8 107 60 126.8 57.5 L 161.1 57.8 C 165 57.8 167 55.5 165.5 52.5 ' +
  'C 164.3 50 162.5 48.3 160.1 46.8 Z ' +
  'M 94.6 37.5 C 95 33.5 99.5 31 105 31 C 111 31 116.5 34.5 117 38 C 116.3 41.5 111.5 45 104.5 45 ' +
  'C 99 45 94.8 41.5 94.6 37.5 Z';

/** The tile's square, in its own units: side 100, corner radius 0.22 of the side (R4.2). */
export const TILE_SIDE = 100;
export const TILE_RADIUS = 22;

/**
 * Where the tile path sits on the square of side 100: the crest's top at 0.16 of the side, the beak's tip at 0.86
 * from the left, the neck leaving through the bottom edge only (R8.2).
 */
export const TILE_PLACEMENT = { x: 9.6, y: 15.86, scale: 0.459 } as const;

/** `TILE_PLACEMENT` as an SVG `transform`. */
export const TILE_TRANSFORM = `translate(${String(TILE_PLACEMENT.x)} ${String(TILE_PLACEMENT.y)}) scale(${String(TILE_PLACEMENT.scale)})`;

/**
 * The code sign `</>` at the tile's lower right (R4.3, R8.4), on the square of side 100: three strokes with round
 * caps and joins, in the symbol's colour. The app icons alone hold it.
 */
export const CODE_SIGN = {
  strokeWidth: 5.5,
  paths: ['M 59 61 L 53.35 67.75 L 59 74.5', 'M 71.25 59.35 L 66.75 76.15', 'M 79 61 L 84.65 67.75 L 79 74.5'],
} as const;
