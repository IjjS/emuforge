// The message function (requirement R4.4, R4.5, R4.8): a message of the current catalogue with its `{name}`
// placeholders filled by text or by React elements, never by HTML; a counted message in the form its language's
// plural rules give; English where the current catalogue lacks a message.

import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';

import { PLACEHOLDER, type Catalogue, type Catalogues, type Message, type MessageKey } from './catalogue';
import { formatNumber, formatTime } from './format';

/** Placeholder values that are all text: the message is text. */
export type TextValues = Readonly<Record<string, string>>;

/** Placeholder values among which an element stands where its placeholder stands. */
export type Values = Readonly<Record<string, string | ReactElement>>;

export interface MessageFunction<K extends string> {
  (key: K, values?: TextValues): string;
  (key: K, values: Values): ReactNode;
}

/** A counted message: `count` chooses the form and fills `{count}`, formatted as a number of the language. */
export interface PluralFunction<K extends string> {
  (key: K, count: number, values?: TextValues): string;
  (key: K, count: number, values: Values): ReactNode;
}

/** Studio's text, times and numbers in one language. */
export interface Messages<K extends string = MessageKey> {
  /** The language's tag. */
  readonly tag: string;
  readonly t: MessageFunction<K>;
  readonly plural: PluralFunction<K>;
  /** The time of day of `at` (milliseconds since the epoch), R5.3. */
  readonly formatTime: (at: number) => string;
  /** A count or a duration, R5.4; never a port, an address or a status code. */
  readonly formatNumber: (value: number) => string;
}

const RULES = new Map<string, Intl.PluralRules>();

function pluralRules(tag: string): Intl.PluralRules {
  let rules = RULES.get(tag);
  if (rules === undefined) {
    rules = new Intl.PluralRules(tag);
    RULES.set(tag, rules);
  }
  return rules;
}

/** The text `message` gives for `count` in `tag`, `undefined` for none or an empty one. */
function textOf(message: Message | undefined, tag: string, count: number | undefined): string | undefined {
  if (message === undefined) {
    return undefined;
  }
  let text: string | undefined;
  if (typeof message === 'string') {
    text = message;
  } else {
    // A category the runtime asks for that the catalogue lacks takes the language's own `other` form (R4.8).
    const category = count === undefined ? 'other' : pluralRules(tag).select(count);
    text = message[category] || message.other;
  }
  return text === '' ? undefined : text;
}

/** `text` with each placeholder replaced by its value: text when every value is text, else a fragment. */
function fill(key: string, text: string, values: Values): ReactNode {
  const parts: (string | ReactElement)[] = [];
  let at = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    if (!Object.hasOwn(values, name)) {
      throw new Error(`The message "${key}" has a placeholder {${name}} that was given no value.`);
    }
    parts.push(text.slice(at, match.index), values[name] as string | ReactElement);
    at = match.index + match[0].length;
  }
  parts.push(text.slice(at));
  if (parts.every((part) => typeof part === 'string')) {
    return parts.join('');
  }
  // Each element is a child of its own, in its place; text is never parsed as HTML.
  return createElement(Fragment, null, ...parts.filter((part) => part !== ''));
}

/** The messages of `tag` from `catalogues`, falling back to English per message (R4.8). */
export function messagesFor<K extends string = MessageKey>(catalogues: Catalogues, tag: string): Messages<K> {
  const current: Catalogue = catalogues.byTag.get(tag) ?? catalogues.source;
  const source = catalogues.source;

  const resolve = (key: string, count: number | undefined): { text: string; tag: string } => {
    const own = textOf(current.messages.get(key), current.tag, count);
    if (own !== undefined) {
      return { text: own, tag: current.tag };
    }
    const english = textOf(source.messages.get(key), source.tag, count);
    if (english === undefined) {
      throw new Error(`The English catalogue has no message "${key}".`);
    }
    return { text: english, tag: source.tag };
  };

  const t = ((key: K, values: Values = {}) => fill(key, resolve(key, undefined).text, values)) as MessageFunction<K>;
  const plural = ((key: K, count: number, values: Values = {}) => {
    const { text, tag: formTag } = resolve(key, count);
    return fill(key, text, { ...values, count: formatNumber(formTag, count) });
  }) as PluralFunction<K>;

  return {
    tag: current.tag,
    t,
    plural,
    formatTime: (at) => formatTime(current.tag, at),
    formatNumber: (value) => formatNumber(current.tag, value),
  };
}
