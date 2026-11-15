// How a link is drawn besides the colour of its text (requirement R5.1: "the marked link is also visibly marked"):
// the computed properties that draw something on the link's own box and on its `::before` and `::after`. A property
// whose value follows the text colour (`border-*-color`, `outline-color`, `text-decoration-color`, whose initial
// value is `currentColor`) counts only where the link draws that edge, line or pseudo-element, so a mark made of the
// text colour alone, or of the text colour and the cursor, differs in nothing here; so does a colour equal to the
// element's own text colour, which is read as `currentColor`. Used by `frame.spec.ts`.

import type { Locator } from '@playwright/test';

import { ACTION } from './frame';

export interface LinkLook {
  /** The computed `color` of the link's text. */
  color: string;
  cursor: string;
  /** What the link draws besides its text colour, by property; `none` where it draws nothing. */
  mark: Record<string, string>;
}

/** Reads how `link` is drawn now. */
export async function lookOf(link: Locator): Promise<LinkLook> {
  return link.evaluate(
    (el) => {
      const mark: Record<string, string> = {};
      const px = (value: string) => parseFloat(value) || 0;
      // A colour equal to the element's own text colour is the text colour, whatever property draws it.
      const own = (value: string, text: string) => value.split(text).join('currentColor');
      const read = (style: CSSStyleDeclaration, prefix: string) => {
        const before = new Set(Object.keys(mark));
        mark[`${prefix}box-shadow`] = style.boxShadow;
        mark[`${prefix}background-color`] = style.backgroundColor;
        mark[`${prefix}background-image`] = style.backgroundImage;
        for (const side of ['top', 'right', 'bottom', 'left']) {
          const width = style.getPropertyValue(`border-${side}-width`);
          const kind = style.getPropertyValue(`border-${side}-style`);
          const drawn = px(width) > 0 && kind !== 'none' && kind !== 'hidden';
          mark[`${prefix}border-${side}`] = drawn
            ? `${width} ${kind} ${style.getPropertyValue(`border-${side}-color`)}`
            : 'none';
        }
        const outline = style.outlineStyle !== 'none' && px(style.outlineWidth) > 0;
        mark[`${prefix}outline`] = outline
          ? `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`
          : 'none';
        for (const name of Object.keys(mark)) if (!before.has(name)) mark[name] = own(mark[name], style.color);
      };
      const style = getComputedStyle(el);
      read(style, '');
      mark['font-weight'] = style.fontWeight;
      const line = style.textDecorationLine;
      mark['text-decoration'] =
        line === 'none'
          ? 'none'
          : own(
              `${line} ${style.textDecorationStyle} ${style.textDecorationThickness} ${style.textDecorationColor}`,
              style.color,
            );
      for (const where of ['::before', '::after']) {
        const p = getComputedStyle(el, where);
        if (p.content === 'none' || p.content === 'normal' || p.display === 'none') {
          mark[where] = 'none';
          continue;
        }
        mark[where] = `${p.content} ${p.width} ${p.height}`;
        read(p, `${where} `);
      }
      return { color: style.color, cursor: style.cursor, mark };
    },
    undefined,
    ACTION,
  );
}

/** The properties of `mark` in which `a` and `b` differ. */
export function markDiffers(a: LinkLook, b: LinkLook): string[] {
  const names = [...new Set([...Object.keys(a.mark), ...Object.keys(b.mark)])];
  return names.filter((name) => (a.mark[name] ?? 'none') !== (b.mark[name] ?? 'none'));
}
