// The two layers of Studio as the built app draws them (requirement R7, R8; test-criteria.md, issue 16): the CSS rules
// of the built app's stylesheets and the elements they match, the AWS area's root, the Cloudscape reference documents
// the area is compared against, and the contrast of Studio's own text and focus indicators. Used by `layers.spec.ts`.
//
// Words, as `test-criteria.md` defines them:
//
// - "A Cloudscape class": a class whose name starts with `awsui`.
// - "The area's root": the element that holds the AWS area's Cloudscape tree. Found from the elements that carry a
//   Cloudscape component class (`awsui_…`): their lowest common ancestor, or, when that ancestor is itself a Cloudscape
//   component, the element that holds it; above a bare wrapper Cloudscape renders around its tree (an element with no
//   attribute, its parent's only child), the element that holds that wrapper. Studio's own layer is every element
//   outside the root: `html`, `body`, the frame and every ancestor of the root; on a page without the area, every
//   element.
// - "The `studio` layer": the cascade layer named `studio` (and its sub-layers `studio.*`) in the built app's
//   stylesheets. Every rule is walked: inside layers, media, supports, container and scope rules, nested rules and
//   imported sheets. A rule "matches" an element when its selector does, with two widenings so that a rule that
//   would match on a user action or on a pseudo-element of the element counts: a pseudo-element stands for the
//   element that originates it (`a::before` matches `a`), and `:hover`, `:active`, `:focus`, `:focus-visible` and
//   `:focus-within` match always. Rules under a media or supports condition that does not hold now match nothing.
// - "A Cloudscape reference document": a blank page in the same browser that loads only the named file of
//   `@cloudscape-design/global-styles` (and, where said, one Cloudscape component), with the same colour scheme,
//   built from the packages Studio itself pins (`studio/node_modules`).
// - "Studio's own source": the `.css` files under `studio/src/` outside `src/providers/` (the folders of Studio's own
//   layer, R6.5).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Browser, BrowserContext, ElementHandle, Page } from '@playwright/test';

import { EnvError, type Ctx } from './check';
import { ACTION, type Frame } from './frame';
import { SERVICE_LABELS } from './home';

export type Scheme = 'light' | 'dark';

/** The inherited text properties of requirement R8.3, compared at the area's root. */
export const TEXT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'color',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-align',
];

/**
 * The CSS properties that inherit by default (CSS specifications' "Inherited: yes"), as Chromium knows them. A
 * custom property inherits too; the check treats every `--*` name as inherited.
 */
const INHERITED = [
  'accent-color',
  'border-collapse',
  'border-spacing',
  'caption-side',
  'caret-color',
  'clip-rule',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-rendering',
  'color-scheme',
  'cursor',
  'direction',
  'dominant-baseline',
  'empty-cells',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-language-override',
  'font-optical-sizing',
  'font-palette',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-synthesis',
  'font-synthesis-small-caps',
  'font-synthesis-style',
  'font-synthesis-weight',
  'font-variant',
  'font-variant-alternates',
  'font-variant-caps',
  'font-variant-east-asian',
  'font-variant-emoji',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-variant-position',
  'font-variation-settings',
  'font-weight',
  'forced-color-adjust',
  'hanging-punctuation',
  'hyphenate-character',
  'hyphenate-limit-chars',
  'hyphens',
  'image-orientation',
  'image-rendering',
  'letter-spacing',
  'line-break',
  'line-height',
  'list-style',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'math-depth',
  'math-shift',
  'math-style',
  'orphans',
  'overflow-wrap',
  'paint-order',
  'pointer-events',
  'print-color-adjust',
  'quotes',
  'ruby-align',
  'ruby-position',
  'shape-rendering',
  'speak',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-anchor',
  'text-autospace',
  'text-combine-upright',
  'text-decoration-skip-ink',
  'text-emphasis',
  'text-emphasis-color',
  'text-emphasis-position',
  'text-emphasis-style',
  'text-indent',
  'text-justify',
  'text-orientation',
  'text-rendering',
  'text-shadow',
  'text-size-adjust',
  'text-spacing-trim',
  'text-transform',
  'text-underline-offset',
  'text-underline-position',
  'text-wrap',
  'text-wrap-style',
  'visibility',
  'white-space',
  'white-space-collapse',
  'widows',
  'word-break',
  'word-spacing',
  'word-wrap',
  'writing-mode',
  '-webkit-border-horizontal-spacing',
  '-webkit-border-vertical-spacing',
  '-webkit-font-smoothing',
  '-webkit-hyphenate-character',
  '-webkit-locale',
  '-webkit-print-color-adjust',
  '-webkit-rtl-ordering',
  '-webkit-tap-highlight-color',
  '-webkit-text-combine',
  '-webkit-text-emphasis',
  '-webkit-text-emphasis-color',
  '-webkit-text-emphasis-position',
  '-webkit-text-emphasis-style',
  '-webkit-text-fill-color',
  '-webkit-text-orientation',
  '-webkit-text-security',
  '-webkit-text-size-adjust',
  '-webkit-text-stroke',
  '-webkit-text-stroke-color',
  '-webkit-text-stroke-width',
  '-webkit-user-modify',
  '-webkit-writing-mode',
];

/** The AWS area's `SideNavigation` and its links, as Cloudscape's test utilities find them. */
const NAVIGATION = createWrapper().findSideNavigation();
const SELECTORS = {
  navigation: NAVIGATION.toSelector(),
  header: NAVIGATION.findHeaderLink().toSelector(),
  active: NAVIGATION.findActiveLink().toSelector(),
  links: `${NAVIGATION.toSelector()} a[href]`,
};

// ---------------------------------------------------------------------------------------------------------------
// The probe: one script installed in the page, holding the rule walk and the measurements. Everything it reports is
// read from the page as the browser has it; nothing is replaced.
// ---------------------------------------------------------------------------------------------------------------

/** What a report of the page says about one layer leaking into the other. */
export interface LayerReport {
  /** The area's root, described; `null` when the page has no element with a Cloudscape component class. */
  root: string | null;
  /** Why the root found is not one the checks can use (it is `html` or `body`, it holds the frame's banner). */
  rootProblems: string[];
  /** How many elements are outside the root (Studio's own layer) and inside it. */
  outside: number;
  inside: number;
  /** Elements of Studio's own layer that carry a Cloudscape class. */
  cloudscapeOutside: string[];
  /** The `awsui-` classes of `html` and of `body`. */
  htmlBodyAwsui: string[];
  /** Every element with the class `awsui-dark-mode`. */
  darkModeHolders: string[];
  /** The elements of Studio's own layer (outside the area's root) with the class `awsui-dark-mode`. */
  darkModeOutside: string[];
  /** Whether the area's root carries `awsui-dark-mode`. */
  rootDarkMode: boolean;
  /** Rules outside the `studio` layer that declare a property other than a custom property and match an element of Studio's own layer. */
  foreignOnOutside: string[];
  /** Rules of the `studio` layer that match the area's root or an element inside it. */
  studioInside: string[];
  /** Rules of the `studio` layer that match `html`, `body` or an ancestor of the root and declare an inherited property other than `color-scheme` and `--st-*`. */
  studioInheritedOnAncestors: string[];
  /** The text properties of `TEXT_PROPERTIES` at the area's root; `null` without a root. */
  rootText: Record<string, string> | null;
  /** Style rules the walk could not match (a selector the browser keeps but `matches` refuses), counted. */
  unmatchable: number;
  /** Stylesheets whose rules could not be read. */
  unreadable: string[];
}

/** How Studio's own source maps onto the built app's stylesheets (R7.2). */
export interface SourceReport {
  /** Source rules found in the built app inside the `studio` layer. */
  inStudio: number;
  /** Source rules found in the built app outside the `studio` layer, each with where it sits. */
  outsideStudio: string[];
  /** Source selectors not found in the built app (the build may have merged or rewritten them), counted. */
  notFound: number;
  /** Declarations of the `studio` layer that are `!important`. */
  important: string[];
  /** Custom properties declared in the `studio` layer whose name does not start with `--st-`. */
  foreignCustom: string[];
  /** How many style rules the `studio` layer holds in the built app. */
  studioRules: number;
}

declare global {
  interface Window {
    __emuforgeLayers?: Record<string, (...args: never[]) => unknown>;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function installProbe(): void {
  if (window.__emuforgeLayers) return;

  const PSEUDO_ELEMENT = /::[-\w]+(\((?:[^()]|\([^()]*\))*\))?|:(?:before|after|first-line|first-letter)(?![-\w])/gi;
  const USER_ACTION = /:(?:hover|active|focus-visible|focus-within|focus)(?![-\w])/gi;

  const describe = (el: Element | null): string => {
    if (!el) return 'nothing';
    if (el === document.documentElement) return 'html';
    if (el === document.body) return 'body';
    const classes = [...el.classList].slice(0, 2).map((c) => `.${c}`);
    const id = el.id ? `#${el.id}` : '';
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return `${el.tagName.toLowerCase()}${id}${classes.join('')}${text ? ` "${text}"` : ''}`;
  };

  /** Splits a selector list at its top-level commas. */
  const splitList = (list: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let quote = '';
    let from = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '\\') i++;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) {
        out.push(list.slice(from, i).trim());
        from = i + 1;
      }
    }
    out.push(list.slice(from).trim());
    return out.filter((s) => s !== '');
  };

  /** A nested rule's selector against its parent's, as the browser resolves `&` (or an implied descendant). */
  const nest = (selector: string, parent: string | null): string => {
    if (parent === null) return selector;
    return splitList(selector)
      .map((s) => (s.includes('&') ? s.split('&').join(`:is(${parent})`) : `:is(${parent}) ${s}`))
      .join(', ');
  };

  const matchable = (selector: string): string | null => {
    const widened = selector.replace(PSEUDO_ELEMENT, ':is(*)').replace(USER_ACTION, ':is(*)');
    try {
      document.documentElement.matches(widened);
      return widened;
    } catch {
      return null;
    }
  };

  interface Rule {
    kind: 'style' | 'font-face' | 'other';
    rule: CSSRule;
    style: CSSStyleDeclaration | null;
    selector: string | null;
    match: string | null;
    layer: string;
    applies: boolean;
    sheet: string;
  }

  const isStudio = (layer: string) => layer === 'studio' || layer.startsWith('studio.');

  const walk = (sheets: CSSStyleSheet[]) => {
    const rules: Rule[] = [];
    const unreadable: string[] = [];
    const visit = (
      list: CSSRuleList,
      at: { layer: string; applies: boolean; parent: string | null; scope: string | null; sheet: string },
    ) => {
      for (const rule of [...list]) {
        const join = (name: string) => (at.layer ? `${at.layer}.${name || '<anonymous>'}` : name || '<anonymous>');
        if (rule instanceof CSSImportRule) {
          const sheet = rule.styleSheet;
          if (!sheet) continue;
          const layer = rule.layerName === null ? at.layer : join(rule.layerName);
          const media = rule.media.mediaText;
          try {
            visit(sheet.cssRules, {
              ...at,
              layer,
              applies: at.applies && (media === '' || matchMedia(media).matches),
              sheet: sheet.href ?? at.sheet,
            });
          } catch {
            unreadable.push(sheet.href ?? 'an imported sheet');
          }
        } else if (rule instanceof CSSLayerBlockRule) {
          visit(rule.cssRules, { ...at, layer: join(rule.name) });
        } else if (rule instanceof CSSMediaRule) {
          visit(rule.cssRules, { ...at, applies: at.applies && matchMedia(rule.media.mediaText).matches });
        } else if (rule instanceof CSSSupportsRule) {
          visit(rule.cssRules, { ...at, applies: at.applies && CSS.supports(rule.conditionText) });
        } else if (typeof CSSScopeRule !== 'undefined' && rule instanceof CSSScopeRule) {
          const start = (rule as any).start as string | null;
          visit(rule.cssRules, { ...at, scope: start ? nest(start, at.scope) : at.scope });
        } else if (rule instanceof CSSStyleRule) {
          let selector = nest(rule.selectorText, at.parent);
          if (at.scope !== null && at.parent === null) {
            selector = splitList(selector)
              .map((s) => (s.includes(':scope') ? s.split(':scope').join(`:is(${at.scope})`) : `:is(${at.scope}) ${s}`))
              .join(', ');
          }
          rules.push({
            kind: 'style',
            rule,
            style: rule.style,
            selector,
            match: matchable(selector),
            layer: at.layer,
            applies: at.applies,
            sheet: at.sheet,
          });
          if (rule.cssRules && rule.cssRules.length > 0) visit(rule.cssRules, { ...at, parent: selector });
        } else if (
          typeof (window as any).CSSNestedDeclarations !== 'undefined' &&
          rule instanceof (window as any).CSSNestedDeclarations
        ) {
          const selector = at.parent ?? ':root';
          rules.push({
            kind: 'style',
            rule,
            style: (rule as any).style,
            selector,
            match: matchable(selector),
            layer: at.layer,
            applies: at.applies,
            sheet: at.sheet,
          });
        } else if (rule instanceof CSSFontFaceRule) {
          rules.push({
            kind: 'font-face',
            rule,
            style: rule.style,
            selector: null,
            match: null,
            layer: at.layer,
            applies: at.applies,
            sheet: at.sheet,
          });
        } else if (rule instanceof CSSKeyframesRule) {
          rules.push({ kind: 'other', rule, style: null, selector: null, match: null, ...at });
        } else if ((rule as any).cssRules) {
          // Container, starting-style and other grouping rules: their rules may apply; counted as applying.
          visit((rule as any).cssRules, at);
        } else {
          rules.push({ kind: 'other', rule, style: null, selector: null, match: null, ...at });
        }
      }
    };
    for (const sheet of sheets) {
      if (sheet.disabled) continue;
      const media = sheet.media?.mediaText ?? '';
      const where =
        sheet.href ??
        (sheet.ownerNode ? `<${sheet.ownerNode.nodeName.toLowerCase()}> in the page` : 'an adopted sheet');
      try {
        visit(sheet.cssRules, {
          layer: '',
          applies: media === '' || matchMedia(media).matches,
          parent: null,
          scope: null,
          sheet: where,
        });
      } catch {
        unreadable.push(where);
      }
    }
    return { rules, unreadable };
  };

  const documentRules = () => walk([...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]);

  /** The custom properties Lightning CSS adds beside a `color-scheme` declaration (see `sourceInBuilt`). */
  const MINIFIER_SCHEME_PROPERTIES = ['--lightningcss-light', '--lightningcss-dark'];

  const names = (style: CSSStyleDeclaration | null): string[] => {
    const out: string[] = [];
    if (!style) return out;
    for (let i = 0; i < style.length; i++) out.push(style[i]);
    return out;
  };

  const ruleName = (r: Rule) =>
    `"${(r.selector ?? '').slice(0, 120)}" (${r.layer ? `layer ${r.layer}` : 'no layer'}, ${r.sheet.replace(location.origin, '')})`;

  /** The area's root: see the head of this file. */
  const findRoot = (): Element | null => {
    const tree = [...document.querySelectorAll('[class*="awsui_"]')].filter((el) =>
      [...el.classList].some((c) => c.startsWith('awsui_')),
    );
    if (tree.length === 0) return null;
    let common: Element | null = tree[0];
    for (const el of tree.slice(1)) {
      while (common && !common.contains(el)) common = common.parentElement;
    }
    if (common && [...common.classList].some((c) => c.startsWith('awsui_'))) common = common.parentElement;
    // Cloudscape renders bare wrappers of its own (an `AppLayout` puts a `div` with no attribute around its `main`):
    // they belong to the tree, so the holder is above them.
    while (
      common &&
      common.attributes.length === 0 &&
      common.parentElement &&
      common.parentElement !== document.body &&
      common.parentElement.children.length === 1
    )
      common = common.parentElement;
    return common;
  };

  const elementsOutside = (root: Element | null) =>
    [...document.querySelectorAll('*')].filter((el) => root === null || !root.contains(el));
  const elementsInside = (root: Element | null) => (root ? [root, ...root.querySelectorAll('*')] : []);

  const textOf = (el: Element) => {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const name of (window as any).__emuforgeTextProperties as string[]) out[name] = cs.getPropertyValue(name);
    return out;
  };

  const awsuiClasses = (el: Element) => [...el.classList].filter((c) => c.startsWith('awsui'));

  /** Groups rule findings by rule, naming up to four elements each, at most `limit` rules. */
  const grouped = (hits: Map<Rule, { what: string; elements: Element[] }>, limit = 15) => {
    const out: string[] = [];
    for (const [rule, { what, elements }] of hits) {
      if (out.length >= limit) {
        out.push(`… and ${String(hits.size - limit)} more rules`);
        break;
      }
      const shown = elements.slice(0, 4).map(describe).join(', ');
      out.push(
        `${ruleName(rule)} ${what} matches ${shown}${elements.length > 4 ? ` and ${String(elements.length - 4)} more` : ''}`,
      );
    }
    return out;
  };

  const report = (banner: Element | null, withArea: boolean) => {
    const { rules, unreadable } = documentRules();
    const root = withArea ? findRoot() : null;
    const rootProblems: string[] = [];
    if (withArea) {
      if (root === null) rootProblems.push('the page has no element with a Cloudscape component class: no AWS area');
      else if (root === document.documentElement || root === document.body)
        rootProblems.push(`the AWS area's root is ${describe(root)}`);
      if (banner === null) rootProblems.push('the page has no Studio frame banner ("EmuForge Studio")');
      else if (root && root.contains(banner)) rootProblems.push("the AWS area's root holds Studio's frame banner");
    }
    const usableRoot = rootProblems.length === 0 ? root : null;
    const outside = elementsOutside(usableRoot);
    const inside = elementsInside(usableRoot);
    const ancestors: Element[] = [];
    for (let a = usableRoot?.parentElement ?? null; a; a = a.parentElement) ancestors.push(a);

    let unmatchable = 0;
    const foreign = new Map<Rule, { what: string; elements: Element[] }>();
    const studioIn = new Map<Rule, { what: string; elements: Element[] }>();
    const inherited = new Map<Rule, { what: string; elements: Element[] }>();
    const inheritedNames = new Set((window as any).__emuforgeInherited as string[]);
    for (const r of rules) {
      if (r.kind !== 'style' || !r.applies) continue;
      if (r.match === null) {
        unmatchable++;
        continue;
      }
      const props = names(r.style);
      if (isStudio(r.layer)) {
        const hitInside = inside.filter((el) => el.matches(r.match!));
        if (hitInside.length > 0) studioIn.set(r, { what: `{${props.slice(0, 6).join('; ')}}`, elements: hitInside });
        const minifier = props.includes('color-scheme') ? MINIFIER_SCHEME_PROPERTIES : [];
        const leaking = props.filter(
          (p) =>
            (p.startsWith('--') ? !p.startsWith('--st-') && !minifier.includes(p) : inheritedNames.has(p)) &&
            p !== 'color-scheme',
        );
        if (leaking.length > 0 && usableRoot) {
          const hit = ancestors.filter((el) => el.matches(r.match!));
          if (hit.length > 0) inherited.set(r, { what: `declares ${leaking.join(', ')} and`, elements: hit });
        }
      } else {
        const real = props.filter((p) => !p.startsWith('--'));
        if (real.length === 0) continue;
        const hit = outside.filter((el) => el.matches(r.match!));
        if (hit.length > 0) foreign.set(r, { what: `declares ${real.slice(0, 6).join(', ')} and`, elements: hit });
      }
    }
    const cloudscapeOutside = outside
      .filter((el) => awsuiClasses(el).length > 0)
      .map((el) => `${describe(el)} [${awsuiClasses(el).join(' ')}]`);
    return {
      root: root ? describe(root) : null,
      rootProblems,
      outside: outside.length,
      inside: inside.length,
      cloudscapeOutside: cloudscapeOutside.slice(0, 15),
      htmlBodyAwsui: [
        ...awsuiClasses(document.documentElement).map((c) => `html.${c}`),
        ...awsuiClasses(document.body).map((c) => `body.${c}`),
      ],
      darkModeHolders: [...document.querySelectorAll('.awsui-dark-mode')].map(describe),
      darkModeOutside: outside.filter((el) => el.classList.contains('awsui-dark-mode')).map(describe),
      rootDarkMode: usableRoot ? usableRoot.classList.contains('awsui-dark-mode') : false,
      foreignOnOutside: grouped(foreign),
      studioInside: grouped(studioIn),
      studioInheritedOnAncestors: grouped(inherited),
      rootText: usableRoot ? textOf(usableRoot) : null,
      unmatchable,
      unreadable,
    };
  };

  /**
   * Cloudscape's `index-base.css` (its text given) applied in the page: its rules `htmlRules` and `bodyRules` (indexes
   * of the rules that match `html` and `body` of the reference document) must reach the area's root, every other
   * rule each element inside the area its selector matches; and none of them any element outside. A rule "reaches" an
   * element when every property it declares is declared on that element by a rule outside the `studio` layer that
   * matches it (the build may merge, split or rewrite the rules, and keeps their properties).
   */
  const baseApplied = (text: string, htmlRules: number[], bodyRules: number[]) => {
    const base = new CSSStyleSheet();
    base.replaceSync(text);
    const baseRules = walk([base]).rules.filter((r) => r.kind === 'style' && r.applies);
    const root = findRoot();
    const findings: string[] = [];
    if (root === null || root === document.documentElement || root === document.body) {
      return { findings: ['the page has no AWS area root'], checked: 0 };
    }
    const own = walk([...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]).rules.filter(
      (r) => r.kind === 'style' && r.applies && r.match !== null && !isStudio(r.layer),
    );
    const declaredOn = (el: Element) => {
      const set = new Set<string>();
      for (const r of own) if (el.matches(r.match!)) for (const p of names(r.style)) set.add(p);
      return set;
    };
    const cache = new Map<Element, Set<string>>();
    const on = (el: Element) => {
      if (!cache.has(el)) cache.set(el, declaredOn(el));
      return cache.get(el)!;
    };
    const reaches = (r: Rule, el: Element) => names(r.style).every((p) => on(el).has(p));
    const missing = (r: Rule, el: Element) => names(r.style).filter((p) => !on(el).has(p));
    const outside = elementsOutside(root);
    const inside = [...root.querySelectorAll('*')];
    let checked = 0;
    baseRules.forEach((r, i) => {
      const props = names(r.style);
      if (props.length === 0) return;
      const label = `index-base "${r.selector}" {${props.slice(0, 5).join('; ')}}`;
      if (htmlRules.includes(i) || bodyRules.includes(i)) {
        checked++;
        const lacking = missing(r, root);
        if (lacking.length > 0) findings.push(`${label} does not reach the area's root (${lacking.join(', ')})`);
        const target = htmlRules.includes(i) ? document.documentElement : document.body;
        if (reaches(r, target)) findings.push(`${label} reaches ${describe(target)} outside the area`);
        return;
      }
      if (r.match === null) return;
      const targets = inside.filter((el) => el.matches(r.match!));
      const unreached = targets.filter((el) => !reaches(r, el));
      checked += targets.length;
      if (unreached.length > 0)
        findings.push(
          `${label} does not reach ${String(unreached.length)} of ${String(targets.length)} elements inside the area (${unreached.slice(0, 3).map(describe).join(', ')})`,
        );
      const leaked = outside.filter((el) => el.matches(r.match!) && reaches(r, el));
      if (leaked.length > 0)
        findings.push(`${label} reaches ${leaked.slice(0, 3).map(describe).join(', ')} outside the area`);
    });
    return { findings, checked };
  };

  /**
   * Which rules of a sheet (its text given) are its `html` and `body` rules, by index: they match `html` or `body` of
   * this document and not an ordinary element in it. A rule for every element (`*`, a bare pseudo-element such as
   * `::-webkit-file-upload-button`) is not one; it is checked on the elements inside the area.
   */
  const rulesOnRoot = (text: string) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    const rules = walk([sheet]).rules.filter((r) => r.kind === 'style' && r.applies);
    const html: number[] = [];
    const body: number[] = [];
    const ordinary = document.body.appendChild(document.createElement('div'));
    rules.forEach((r, i) => {
      if (r.match === null || names(r.style).length === 0) return;
      if (ordinary.matches(r.match)) return;
      if (document.documentElement.matches(r.match)) html.push(i);
      if (document.body.matches(r.match)) body.push(i);
    });
    ordinary.remove();
    return { html, body };
  };

  const normSelector = (s: string) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\s*([>+~])\s*/g, '$1')
      .replace(/\*(?=[:.#[])/g, '')
      .replace(/(^|[^:]):(before|after|first-line|first-letter)(?![-\w])/g, '$1::$2')
      .trim();

  /** Studio's own source (its files' texts) against the built app's stylesheets. */
  const sourceInBuilt = (texts: string[]) => {
    const built = documentRules().rules.filter((r) => r.kind === 'style' && r.selector !== null);
    const index = new Map<string, Rule[]>();
    for (const r of built) {
      for (const s of splitList(r.selector!)) {
        const key = normSelector(s);
        if (!index.has(key)) index.set(key, []);
        index.get(key)!.push(r);
      }
    }
    let inStudio = 0;
    let notFound = 0;
    const outsideStudio = new Set<string>();
    for (const text of texts) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      for (const r of walk([sheet]).rules) {
        if (r.kind !== 'style' || r.selector === null) continue;
        const props = new Set(names(r.style));
        if (props.size === 0) continue;
        for (const s of splitList(r.selector)) {
          const same = (index.get(normSelector(s)) ?? []).filter((b) => names(b.style).some((p) => props.has(p)));
          if (same.length === 0) notFound++;
          else if (same.some((b) => isStudio(b.layer))) inStudio++;
          for (const b of same) if (!isStudio(b.layer)) outsideStudio.add(`source rule "${s}" is in ${ruleName(b)}`);
        }
      }
    }
    const studio = built.filter((r) => isStudio(r.layer));
    const important: string[] = [];
    const foreignCustom: string[] = [];
    for (const r of studio) {
      const declared = names(r.style);
      // Vite's CSS minifier (Lightning CSS) writes `--lightningcss-light` and `--lightningcss-dark` beside every
      // `color-scheme` declaration, as its own fallback for `light-dark()`. They are the build's, not Studio's
      // source's, and R7.4 requires `color-scheme`; only these two names, and only in a rule that sets it, are passed.
      const minifier = declared.includes('color-scheme') ? MINIFIER_SCHEME_PROPERTIES : [];
      for (const p of declared) {
        if (r.style!.getPropertyPriority(p) === 'important') important.push(`${ruleName(r)} ${p}`);
        if (p.startsWith('--') && !p.startsWith('--st-') && !minifier.includes(p))
          foreignCustom.push(`${ruleName(r)} ${p}`);
      }
    }
    return {
      inStudio,
      outsideStudio: [...outsideStudio].slice(0, 20),
      notFound,
      important: important.slice(0, 20),
      foreignCustom: foreignCustom.slice(0, 20),
      studioRules: studio.length,
    };
  };

  /** The background-color of `el` and the `--st-*` tokens the matching `studio` rules name for it, resolved on `el`. */
  const backgroundToken = (el: Element) => {
    const tokens = new Set<string>();
    for (const r of documentRules().rules) {
      if (r.kind !== 'style' || !r.applies || !isStudio(r.layer) || r.selector === null) continue;
      if (/::|:(?:before|after)\b/.test(r.selector)) continue;
      let hit = false;
      try {
        hit = el.matches(r.selector);
      } catch {
        hit = false;
      }
      if (!hit) continue;
      const value = r.style!.getPropertyValue('background-color') || r.style!.getPropertyValue('background');
      for (const m of value.matchAll(/var\(\s*(--st-[-\w]+)/g)) tokens.add(m[1]);
    }
    const resolved: Record<string, string> = {};
    for (const token of tokens) {
      const probe = document.createElement('div');
      probe.style.cssText = `position:absolute;width:0;height:0;overflow:hidden;background-color:var(${token})`;
      el.appendChild(probe);
      resolved[token] = getComputedStyle(probe).backgroundColor;
      probe.remove();
    }
    return { computed: getComputedStyle(el).backgroundColor, tokens: resolved };
  };

  /** The `@font-face` rules of the page for `families`: where each sits and what it loads. */
  const fontFaces = (families: string[]) => {
    const strip = (s: string) => s.replace(/^['"]|['"]$/g, '').trim();
    const faces = documentRules()
      .rules.filter((r) => r.kind === 'font-face')
      .map((r) => ({
        family: strip(r.style!.getPropertyValue('font-family')),
        sheet: r.sheet,
        sources: [...r.style!.getPropertyValue('src').matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) =>
          m[1].startsWith('data:') ? 'data:' : new URL(m[1], r.sheet.startsWith('http') ? r.sheet : location.href).href,
        ),
      }))
      .filter((f) => families.includes(f.family));
    const loaded = [...document.fonts].filter((f) => families.includes(strip(f.family)) && f.status === 'loaded');
    return { faces, loaded: loaded.length };
  };

  // --- Contrast -------------------------------------------------------------------------------------------------

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const paint = canvas.getContext('2d', { willReadFrequently: true })!;
  /** Any CSS colour as sRGB 0-255 and alpha 0-1, as the browser paints it. */
  const rgba = (color: string): [number, number, number, number] => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000';
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    const d = paint.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top: number[], below: number[]): number[] => {
    const a = top[3];
    return [top[0] * a + below[0] * (1 - a), top[1] * a + below[1] * (1 - a), top[2] * a + below[2] * (1 - a), 1];
  };
  const luminance = (c: number[]) => {
    const ch = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a: number[], b: number[]) => {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const css = (c: number[]) => `rgb(${c.slice(0, 3).map(Math.round).join(' ')})`;
  const COLOR_IN =
    /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b|transparent/gi;

  /** The canvas colour under the page: `Canvas` in `html`'s colour scheme. */
  const canvasColor = () => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;width:0;height:0;background-color:Canvas;color-scheme:${getComputedStyle(document.documentElement).colorScheme}`;
    document.documentElement.appendChild(probe);
    const c = rgba(getComputedStyle(probe).backgroundColor);
    probe.remove();
    return c;
  };

  /**
   * The colours that can sit behind `el`: its own background and its ancestors', composited from the canvas up. A
   * gradient contributes each of its stops, so every colour it can show is a candidate.
   */
  const backgrounds = (el: Element | null): number[][] => {
    const layers: { color: number[]; stops: number[][] }[] = [];
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const color = rgba(cs.backgroundColor);
      const stops =
        cs.backgroundImage && cs.backgroundImage !== 'none' ? (cs.backgroundImage.match(COLOR_IN) ?? []).map(rgba) : [];
      layers.push({ color, stops });
      if (color[3] >= 1 && stops.length === 0) break;
    }
    let below: number[][] = [canvasColor()];
    for (const layer of layers.reverse()) {
      below = below.map((b) => over(layer.color, b));
      if (layer.stops.length > 0) below = [...below, ...layer.stops.flatMap((s) => below.map((b) => over(s, b)))];
      below = below.slice(0, 24);
    }
    return below;
  };

  const opacityOf = (el: Element) => {
    let o = 1;
    for (let a: Element | null = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity) || 0;
    return o;
  };

  /** Hidden from sight though rendered: a visually hidden helper, clipped to nothing, or off the page's start. */
  const hiddenFromSight = (el: Element, rects: DOMRect[]) => {
    for (let a: Element | null = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
      if (/inset\(\s*50%/.test(cs.clipPath)) return true;
      const box = a.getBoundingClientRect();
      if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
    }
    return rects.every((r) => r.right + scrollX <= 0 || r.bottom + scrollY <= 0);
  };

  /** Every visible text node of Studio's own layer (outside the area's root) against what is behind it (R7.5). */
  const textContrast = () => {
    const root = findRoot();
    const failures: string[] = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n as Text).data;
      if (text.trim() === '') continue;
      const el = n.parentElement;
      if (!el || (root && root.contains(el))) continue;
      if (el.closest('script, style, noscript, template, title')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (rects.length === 0 || hiddenFromSight(el, rects)) continue;
      const opacity = opacityOf(el);
      if (opacity === 0) continue;
      checked++;
      const fill = cs.getPropertyValue('-webkit-text-fill-color') || cs.color;
      const ink = rgba(fill);
      ink[3] *= opacity;
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const needed = large ? 3 : 4.5;
      const worst = backgrounds(el)
        .map((bg) => ({ bg, r: ratio(over(ink, bg), bg) }))
        .sort((a, b) => a.r - b.r)[0];
      if (worst.r + 1e-9 < needed) {
        failures.push(
          `"${text.replace(/\s+/g, ' ').trim().slice(0, 40)}" in ${describe(el)}: ${css(over(ink, worst.bg))} on ${css(worst.bg)} is ${worst.r.toFixed(2)}:1, below ${String(needed)}:1 (${String(size)}px, weight ${String(weight)})`,
        );
      }
    }
    return { checked, failures: [...new Set(failures)] };
  };

  // --- Focus ----------------------------------------------------------------------------------------------------

  const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, iframe, [contenteditable=""], [contenteditable="true"], [tabindex]';

  interface Look {
    outline: string;
    shadow: string;
    border: string;
    background: string;
    before: string;
    after: string;
  }
  const lookOf = (el: Element): Look => {
    const cs = getComputedStyle(el);
    const pseudo = (where: string) => {
      const p = getComputedStyle(el, where);
      if (p.content === 'none' || p.content === 'normal' || p.display === 'none') return 'none';
      return `${p.outlineStyle} ${p.outlineWidth} ${p.outlineColor}|${p.boxShadow}|${p.borderTopStyle} ${p.borderTopWidth} ${p.borderTopColor}`;
    };
    return {
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}`,
      shadow: cs.boxShadow,
      border: ['top', 'right', 'bottom', 'left']
        .map(
          (s) =>
            `${cs.getPropertyValue(`border-${s}-style`)} ${cs.getPropertyValue(`border-${s}-width`)} ${cs.getPropertyValue(`border-${s}-color`)}`,
        )
        .join('|'),
      background: cs.backgroundColor,
      before: pseudo('::before'),
      after: pseudo('::after'),
    };
  };
  const rest = new WeakMap<Element, Look>();

  /** Records how every tabbable element of Studio's own layer looks unfocused, and lists the visible ones. */
  const restLooks = () => {
    const root = findRoot();
    const list: string[] = [];
    for (const el of document.querySelectorAll(TABBABLE)) {
      if (root && root.contains(el)) continue;
      if ((el as HTMLElement).tabIndex < 0) continue;
      if (el.getClientRects().length === 0 || getComputedStyle(el).visibility !== 'visible') continue;
      if ((el as HTMLElement).closest('[inert]')) continue;
      rest.set(el, lookOf(el));
      (el as any).__emuforgeTabbable = list.length;
      list.push(describe(el));
    }
    return list;
  };

  /** The focused element: where it is drawn and the contrast of its focus indicator against what is next to it. */
  const focused = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const root = findRoot();
    const box = el.getBoundingClientRect();
    const where = {
      top: box.top + scrollY,
      bottom: box.bottom + scrollY,
      left: box.left + scrollX,
      right: box.right + scrollX,
    };
    const index = (el as any).__emuforgeTabbable as number | undefined;
    const base = {
      describe: describe(el),
      index: index ?? -1,
      inArea: Boolean(root && root.contains(el)),
      where,
    };
    const cs = getComputedStyle(el);
    const before = rest.get(el);
    const now = lookOf(el);
    const parentBg = backgrounds(el.parentElement);
    const ownBg = backgrounds(el);
    let rings: number[][] = [];
    let against: number[][] = [];
    let kind = '';
    const outlineColor = rgba(cs.outlineColor);
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && outlineColor[3] > 0) {
      kind = 'outline';
      rings = [outlineColor];
      const offset = parseFloat(cs.outlineOffset) || 0;
      const width = parseFloat(cs.outlineWidth);
      against = offset + width <= 0 ? ownBg : offset === 0 ? [...parentBg, ...ownBg] : parentBg;
    } else if (now.shadow !== 'none' && now.shadow !== before?.shadow) {
      kind = 'box-shadow';
      rings = (now.shadow.match(COLOR_IN) ?? []).map(rgba).filter((c) => c[3] > 0);
      against = /inset/.test(now.shadow) ? ownBg : parentBg;
    } else if (before && now.border !== before.border) {
      kind = 'border';
      rings = ['top', 'right', 'bottom', 'left'].map((s) => rgba(cs.getPropertyValue(`border-${s}-color`)));
      against = [...parentBg, ...ownBg];
    } else if (before && (now.before !== before.before || now.after !== before.after)) {
      kind = 'pseudo-element';
      const changed = now.before !== before.before ? '::before' : '::after';
      const p = getComputedStyle(el, changed);
      rings = [p.outlineColor, p.borderTopColor, ...(p.boxShadow.match(COLOR_IN) ?? [])]
        .map(rgba)
        .filter((c) => c[3] > 0);
      against = [...parentBg, ...ownBg];
    } else if (before && now.background !== before.background) {
      kind = 'background';
      rings = [rgba(cs.backgroundColor)];
      against = parentBg;
    }
    if (rings.length === 0) return { ...base, indicator: null, ratio: 0, detail: 'no visible focus indicator' };
    let worst = { r: Infinity, ring: rings[0], bg: against[0] };
    for (const ring of rings) {
      for (const bg of against) {
        const r = ratio(over(ring, bg), bg);
        if (r < worst.r) worst = { r, ring: over(ring, bg), bg };
      }
    }
    return {
      ...base,
      indicator: kind,
      ratio: worst.r,
      detail: `${kind} ${css(worst.ring)} next to ${css(worst.bg)}: ${worst.r.toFixed(2)}:1`,
    };
  };

  window.__emuforgeLayers = {
    report,
    baseApplied,
    rulesOnRoot,
    sourceInBuilt,
    backgroundToken,
    fontFaces,
    textContrast,
    restLooks,
    focused,
    text: (el: Element) => textOf(el),
  } as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Installs the probe in the page's current document (again after every load). */
async function probe(page: Page): Promise<void> {
  await page.evaluate(
    ([inherited, text]) => {
      (window as unknown as Record<string, unknown>).__emuforgeInherited = inherited;
      (window as unknown as Record<string, unknown>).__emuforgeTextProperties = text;
    },
    [INHERITED, TEXT_PROPERTIES] as const,
  );
  await page.evaluate(installProbe);
}

type Api = Record<string, (...args: unknown[]) => unknown>;

/** Calls `name` of the probe in the page with `args`. */
async function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  await probe(page);
  return (await page.evaluate(
    ([fn, list]) => {
      const api = window.__emuforgeLayers as unknown as Api;
      return api[fn as string](...(list as unknown[]));
    },
    [name, args] as const,
  )) as T;
}

/**
 * Studio's frame, found as `frame()` of `./frame` describes it: the `banner` that holds the link "EmuForge Studio",
 * its navigation "Studio", and that navigation's "Home" and "AWS". The banner's `has` is relative to the banner, so
 * it names the link alone (a `has` that starts again from the page's `banner` matches nothing inside it).
 */
export function studioFrame(page: Page): Frame {
  const banner = page
    .getByRole('banner')
    .filter({ has: page.getByRole('link', { name: 'EmuForge Studio', exact: true }) });
  const nav = banner.getByRole('navigation', { name: 'Studio', exact: true });
  return {
    banner,
    wordmark: banner.getByRole('link', { name: 'EmuForge Studio', exact: true }),
    nav,
    home: nav.getByRole('link', { name: 'Home', exact: true }),
    aws: nav.getByRole('link', { name: 'AWS', exact: true }),
  };
}

/** The frame's banner as an element handle, when the page has exactly one. */
async function bannerOf(page: Page): Promise<ElementHandle | null> {
  const banner = studioFrame(page).banner;
  if ((await banner.count()) !== 1) return null;
  return banner.elementHandle(ACTION);
}

/**
 * Reads the page as it is now. `withArea`: the page should hold the AWS area, so its root is found and Studio's own
 * layer is what lies outside it; without, the whole document is Studio's own layer.
 */
export async function layerReport(page: Page, withArea: boolean): Promise<LayerReport> {
  const banner = await bannerOf(page);
  await probe(page);
  return page.evaluate(([b, area]) => (window.__emuforgeLayers as unknown as Api).report(b, area) as LayerReport, [
    banner,
    withArea,
  ] as const);
}

/** The `.css` files of Studio's own source (outside `src/providers/`), with the problems of their top level. */
export function studioSource(ctx: Ctx): { files: Record<string, string>; outsideLayer: string[] } {
  const src = path.join(ctx.studioDir, 'src');
  const files: Record<string, string> = {};
  const visit = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.relative(src, full) === 'providers') continue;
        visit(full);
      } else if (entry.name.endsWith('.css')) files[path.relative(src, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  visit(src);
  const outsideLayer: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    for (const top of topLevel(text)) {
      const prelude = top.prelude.replace(/\s+/g, ' ').trim();
      if (top.block && /^@layer\s+studio(\.[-\w.]+)?$/.test(prelude)) continue;
      if (!top.block && /^@layer\b/.test(prelude)) continue;
      if (!top.block && /^@charset\b/.test(prelude)) continue;
      if (!top.block && /^@import\b/.test(prelude)) {
        if (/\blayer\(\s*studio(\.[-\w.]+)?\s*\)/.test(prelude)) continue;
        const target = /^@import\s+(?:url\(\s*)?['"]?([^'")\s]+)/.exec(prelude)?.[1] ?? '';
        const resolved = path.relative(src, path.resolve(path.dirname(path.join(src, name)), target));
        if (target.startsWith('.') && resolved in files) continue;
        outsideLayer.push(
          `${name}: "${prelude.slice(0, 100)}" imports a sheet that is not Studio's own source, outside the studio layer`,
        );
        continue;
      }
      outsideLayer.push(`${name}: "${prelude.slice(0, 100)}" is outside the studio layer`);
    }
  }
  return { files, outsideLayer };
}

/** The top-level statements and blocks of a stylesheet's text, comments removed. */
function topLevel(text: string): { prelude: string; block: boolean }[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { prelude: string; block: boolean }[] = [];
  let depth = 0;
  let quote = '';
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (depth === 0) prelude += c;
      if (c === '\\') {
        if (depth === 0) prelude += css[i + 1] ?? '';
        i++;
      } else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      if (depth === 0) prelude += c;
    } else if (c === '{') {
      if (depth === 0) {
        out.push({ prelude, block: true });
        prelude = '';
      }
      depth++;
    } else if (c === '}') {
      depth--;
    } else if (c === ';' && depth === 0) {
      if (prelude.trim()) out.push({ prelude, block: false });
      prelude = '';
    } else if (depth === 0) prelude += c;
  }
  if (prelude.trim()) out.push({ prelude, block: false });
  return out;
}

/** Studio's own source (`studioSource(ctx).files`) against the built app's stylesheets in the page. */
export async function sourceReport(page: Page, files: Record<string, string>): Promise<SourceReport> {
  return call<SourceReport>(page, 'sourceInBuilt', Object.values(files));
}

/**
 * The precondition of the layer checks: the built app has a `studio` cascade layer holding rules from Studio's own
 * source. `[]` when it holds; else what is missing.
 */
export async function studioLayerMissing(page: Page, ctx: Ctx): Promise<string[]> {
  const { files } = studioSource(ctx);
  if (Object.keys(files).length === 0) return ["Studio's own source (studio/src outside providers/) has no .css file"];
  const found = await sourceReport(page, files);
  if (found.studioRules === 0) return ["the built app's stylesheets have no `studio` cascade layer"];
  if (found.inStudio === 0) return ["the built app's `studio` layer holds no rule of Studio's own source"];
  return [];
}

export async function backgroundToken(
  page: Page,
): Promise<{ computed: string; tokens: Record<string, string> } | null> {
  const banner = await bannerOf(page);
  if (banner === null) return null;
  await probe(page);
  return page.evaluate(
    (b) =>
      (window.__emuforgeLayers as unknown as Api).backgroundToken(b) as {
        computed: string;
        tokens: Record<string, string>;
      },
    banner,
  );
}

export async function fontFaces(
  page: Page,
  families: string[],
): Promise<{ faces: { family: string; sheet: string; sources: string[] }[]; loaded: number }> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return call(page, 'fontFaces', families);
}

export async function baseApplied(
  page: Page,
  reference: IndexBaseReference,
): Promise<{ findings: string[]; checked: number }> {
  return call(page, 'baseApplied', reference.text, reference.htmlRules, reference.bodyRules);
}

export async function textContrast(page: Page): Promise<{ checked: number; failures: string[] }> {
  return call(page, 'textContrast');
}

export interface Focused {
  describe: string;
  index: number;
  inArea: boolean;
  where: { top: number; bottom: number; left: number; right: number };
  indicator: string | null;
  ratio: number;
  detail: string;
}

/**
 * Tabs through the page from its start, at most `bound` presses, until focus leaves the document or comes back to an
 * element already met. Returns what each press focused and the visible tabbable elements of Studio's own layer.
 */
export async function tabSweep(page: Page, bound = 120): Promise<{ stops: Focused[]; tabbable: string[] }> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  const tabbable = await call<string[]>(page, 'restLooks');
  const stops: Focused[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < bound; i++) {
    await page.keyboard.press('Tab');
    const now = await call<Focused | null>(page, 'focused');
    if (now === null) break;
    const key = `${now.describe}@${String(now.index)}@${String(Math.round(now.where.top))}:${String(Math.round(now.where.left))}`;
    if (seen.has(key)) break;
    seen.add(key);
    stops.push(now);
  }
  return { stops, tabbable };
}

/** Pairs of consecutive focus stops whose order goes against the visible order (up, or left on the same line). */
export function orderProblems(stops: Focused[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1].where;
    const b = stops[i].where;
    const sameLine = b.top < a.bottom && b.bottom > a.top;
    if ((sameLine && b.left < a.left - 1) || (!sameLine && b.bottom <= a.top)) {
      out.push(`${stops[i].describe} comes after ${stops[i - 1].describe} in Tab order but is drawn before it`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Cloudscape reference documents.
// ---------------------------------------------------------------------------------------------------------------

const GLOBAL_STYLES = path.join('node_modules', '@cloudscape-design', 'global-styles');

function packageFile(ctx: Ctx, file: string): string {
  const full = path.join(ctx.studioDir, GLOBAL_STYLES, file);
  if (!fs.existsSync(full)) throw new Error(`no ${file} in studio's @cloudscape-design/global-styles (${full})`);
  return fs.readFileSync(full, 'utf8');
}

/** The font families Cloudscape's `fonts.css` declares. */
export function cloudscapeFontFamilies(ctx: Ctx): string[] {
  const text = packageFile(ctx, 'fonts.css');
  return [...new Set([...text.matchAll(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/g)].map((m) => m[1].trim()))];
}

/** A context of the same browser for a reference document: the scheme given, nothing reaching the network. */
async function referenceContext(browser: Browser, scheme: Scheme): Promise<BrowserContext> {
  const context = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) => route.abort('blockedbyclient'));
  return context;
}

export interface IndexBaseReference {
  /** The text of `index-base.css`. */
  text: string;
  /** `TEXT_PROPERTIES` on the reference document's `html`. */
  html: Record<string, string>;
  /** Indexes (in the walk of `text`) of the rules that match the reference document's `html`, and its `body`. */
  htmlRules: number[];
  bodyRules: number[];
}

const indexBaseCache = new Map<Scheme, IndexBaseReference>();

/**
 * A blank document that loads only `index-base.css` and, when the scheme is dark, has `awsui-dark-mode` on `html`
 * (requirement R8.3).
 */
export async function indexBaseReference(browser: Browser, ctx: Ctx, scheme: Scheme): Promise<IndexBaseReference> {
  const cached = indexBaseCache.get(scheme);
  if (cached) return cached;
  const text = packageFile(ctx, 'index-base.css');
  const context = await referenceContext(browser, scheme);
  try {
    const page = await context.newPage();
    const dark = scheme === 'dark' ? ' class="awsui-dark-mode"' : '';
    await page.setContent(
      `<!doctype html><html lang="en"${dark}><head><meta charset="utf-8"><style>${text}</style></head><body></body></html>`,
    );
    await probe(page);
    const html = await page.evaluate(
      () => (window.__emuforgeLayers as unknown as Api).text(document.documentElement) as Record<string, string>,
    );
    const { html: htmlRules, body: bodyRules } = await page.evaluate(
      (t) => (window.__emuforgeLayers as unknown as Api).rulesOnRoot(t) as { html: number[]; body: number[] },
      text,
    );
    const reference = { text, html, htmlRules, bodyRules };
    ctx.log(
      `reference index-base.css ${scheme}: html ${JSON.stringify(html)}; rules on html ${JSON.stringify(htmlRules)}, on body ${JSON.stringify(bodyRules)}`,
    );
    indexBaseCache.set(scheme, reference);
    return reference;
  } finally {
    await context.close();
  }
}

export interface NavigationLook {
  /** The `SideNavigation` root's computed `background-color`. */
  background: string;
  /** The header link's computed `color`. */
  header: string;
  /** The computed `color` of the links that are not the active one, distinct values. */
  links: string[];
}

/** The side navigation's colours in the page as it is now; `null` when it has none. */
export async function navigationLook(page: Page): Promise<NavigationLook | null> {
  return page.evaluate((s) => {
    const nav = document.querySelector(s.navigation);
    if (!nav) return null;
    const header = document.querySelector(s.header);
    const active = document.querySelector(s.active);
    const links = [...document.querySelectorAll(s.links)].filter((a) => a !== header && a !== active);
    return {
      background: getComputedStyle(nav).backgroundColor,
      header: header ? getComputedStyle(header).color : 'no header link',
      links: [...new Set(links.map((a) => getComputedStyle(a).color))],
    };
  }, SELECTORS);
}

let navigationBuild: Promise<string> | null = null;

/**
 * Builds, once per run, a blank page with Vite from Studio's own pinned packages: `index.css` of
 * `@cloudscape-design/global-styles`, `applyMode` on `body` following the colour scheme, and one Cloudscape
 * `SideNavigation` with the AWS area's header and its "Services" section. Returns the built folder.
 */
function buildNavigationReference(ctx: Ctx): Promise<string> {
  navigationBuild ??= (async () => {
    const dir = path.join(ctx.tmp, 'cloudscape-reference');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(path.join(ctx.studioDir, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const items = SERVICE_LABELS.map((text, i) => ({ type: 'link', text, href: `/reference/${String(i)}` }));
    fs.writeFileSync(
      path.join(dir, 'main.js'),
      [
        "import '@cloudscape-design/global-styles/index.css';",
        "import { applyMode, Mode } from '@cloudscape-design/global-styles';",
        "import SideNavigation from '@cloudscape-design/components/side-navigation';",
        "import { createElement } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "applyMode(matchMedia('(prefers-color-scheme: dark)').matches ? Mode.Dark : Mode.Light);",
        `const items = [{ type: 'section', text: 'Services', items: ${JSON.stringify(items)} }];`,
        "createRoot(document.getElementById('root')).render(",
        "  createElement(SideNavigation, { header: { text: 'Amazon Web Services', href: '/reference' }, items }),",
        ');',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>reference</title></head><body><div id="root"></div><script type="module" src="./main.js"></script></body></html>',
    );
    fs.writeFileSync(
      path.join(dir, 'vite.config.mjs'),
      "export default { logLevel: 'warn', base: './', build: { outDir: 'dist', emptyOutDir: true } };\n",
    );
    const vite = path.join(ctx.studioDir, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(vite)) throw new Error(`no vite in studio/node_modules (${vite})`);
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [vite, 'build', '--config', 'vite.config.mjs'],
        { cwd: dir, env: { HOME: ctx.home, PATH: process.env.PATH ?? '', NODE_ENV: 'production' }, timeout: 120_000 },
        (error, stdout, stderr) => {
          ctx.log(`vite build of the SideNavigation reference: ${`${stdout}\n${stderr}`.trim().slice(0, 2000)}`);
          if (error) reject(new EnvError(`the SideNavigation reference document did not build: ${error.message}`));
          else resolve();
        },
      );
    });
    return path.join(dir, 'dist');
  })();
  return navigationBuild;
}

const navigationCache = new Map<Scheme, NavigationLook>();

/** The side navigation's colours in the `SideNavigation` reference document, in `scheme` (requirement R8.2a). */
export async function navigationReference(browser: Browser, ctx: Ctx, scheme: Scheme): Promise<NavigationLook> {
  const cached = navigationCache.get(scheme);
  if (cached) return cached;
  const dist = await buildNavigationReference(ctx);
  const origin = `http://127.0.0.1:${String(ctx.studioPort)}`;
  const prefix = `${origin}/__cloudscape-reference/`;
  const context = await referenceContext(browser, scheme);
  try {
    await context.route(`${prefix}**`, async (route) => {
      const rel = new URL(route.request().url()).pathname.slice('/__cloudscape-reference/'.length) || 'index.html';
      const file = path.join(dist, rel);
      if (!file.startsWith(dist) || !fs.existsSync(file)) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      const type = file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream';
      await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
    });
    const page = await context.newPage();
    await page.goto(`${prefix}index.html`);
    await page.locator(SELECTORS.header).waitFor({ state: 'visible', timeout: 10_000 });
    const look = await navigationLook(page);
    if (look === null) throw new Error('the reference document shows no SideNavigation');
    ctx.log(`reference SideNavigation ${scheme}: ${JSON.stringify(look)}`);
    navigationCache.set(scheme, look);
    return look;
  } finally {
    await context.close();
  }
}
