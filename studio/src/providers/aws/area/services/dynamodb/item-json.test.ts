import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';

import type { Item, Keys } from './api';
import { itemText, KEY_CHANGED, newItemText, NOT_AN_OBJECT, parseItem, type ParsedItem } from './item-json';

// The item editor's text (test-criteria.md, issue 496, "Unit s1 — .../dynamodb/item-json.test.ts").

const KEYS: Keys = { partition: { name: 'pk', type: 'S' }, sort: { name: 'sk', type: 'S' } };

function message(parsed: ParsedItem): string | undefined {
  return parsed.ok ? undefined : parsed.message;
}

/** The text of an item whose key is `pk` `c1`, `sk` `o#001`, with `rest` as the text of further attributes. */
function withKey(rest: string): string {
  return `{"pk": {"S": "c1"}, "sk": {"S": "o#001"}${rest === '' ? '' : `, ${rest}`}}`;
}

const NOT_VALUE = (path: string) =>
  `${path} is not an attribute value. Write it as {"S": "text"}, {"N": "1"} and so on.`;
const NOT_BASE64 = (path: string) => `${path} is not base64. Write a binary value in base64.`;

describe('text that is not a JSON object', () => {
  it.each([[''], ['{'], ['pk'], ['[]'], ['"text"'], ['1'], ['null'], ['true'], ['[{"pk": {"S": "a"}}]']])(
    '%j → the object message',
    (text) => {
      expect(message(parseItem(text, KEYS))).toBe(NOT_AN_OBJECT);
      expect(NOT_AN_OBJECT).toBe('Enter the item as a JSON object of attribute values.');
    },
  );
});

describe('a value that is not an attribute value', () => {
  const wrong: [string, string][] = [
    ['two type names', '{"S": "x", "N": "1"}'],
    ['an unknown type name', '{"STRING": "x"}'],
    ['no type name', '{}'],
    ['N a number', '{"N": 1}'],
    ['S a number', '{"S": 1}'],
    ['B a number', '{"B": 1}'],
    ['BOOL a string', '{"BOOL": "true"}'],
    ['NULL false', '{"NULL": false}'],
    ['a set member not a string', '{"SS": ["a", 1]}'],
    ['NS not an array', '{"NS": "1"}'],
    ['BS a member not a string', '{"BS": [true]}'],
    ['M not an object', '{"M": []}'],
    ['L not an array', '{"L": {"S": "x"}}'],
    ['a string', '"x"'],
    ['null', 'null'],
  ];

  it.each(wrong)('%s, at the top → its message with the path a', (_name, value) => {
    expect(message(parseItem(withKey(`"a": ${value}`), KEYS))).toBe(NOT_VALUE('a'));
  });

  it.each(wrong)('%s, inside M → m.x', (_name, value) => {
    expect(message(parseItem(withKey(`"m": {"M": {"ok": {"S": "y"}, "x": ${value}}}`), KEYS))).toBe(NOT_VALUE('m.x'));
  });

  it.each(wrong)('%s, inside L → l[1]', (_name, value) => {
    expect(message(parseItem(withKey(`"l": {"L": [{"S": "y"}, ${value}]}`), KEYS))).toBe(NOT_VALUE('l[1]'));
  });

  it('deeper down: m.x[0].y', () => {
    expect(message(parseItem(withKey('"m": {"M": {"x": {"L": [{"M": {"y": {"N": 2}}}]}}}'), KEYS))).toBe(
      NOT_VALUE('m.x[0].y'),
    );
  });
});

describe('a binary value that is not base64', () => {
  it.each([
    ['B at the top', '"a": {"B": "not base64!"}', 'a'],
    ['B inside M', '"m": {"M": {"x": {"B": "aGk"}}}', 'm.x'],
    ['B inside L', '"l": {"L": [{"B": "aGk="}, {"B": "#"}]}', 'l[1]'],
    ['a BS member', '"bs": {"BS": ["aGk=", "%%"]}', 'bs[1]'],
  ])('%s → its message with its path', (_name, rest, path) => {
    expect(message(parseItem(withKey(rest), KEYS))).toBe(NOT_BASE64(path));
  });
});

describe('the key', () => {
  it.each([
    ['the partition key missing', '{"sk": {"S": "1"}}', 'pk', 'S'],
    ['the sort key missing', '{"pk": {"S": "1"}}', 'sk', 'S'],
    ['the partition key of another type', '{"pk": {"N": "1"}, "sk": {"S": "1"}}', 'pk', 'S'],
    ['the sort key of another type', '{"pk": {"S": "1"}, "sk": {"B": "aGk="}}', 'sk', 'S'],
  ])('%s → the key message', (_name, text, name, type) => {
    expect(message(parseItem(text, KEYS))).toBe(`The item must hold its key attribute ${name} of type ${type}.`);
  });

  it('a Number and a Binary key are named by their type', () => {
    const keys: Keys = { partition: { name: 'id', type: 'B' }, sort: { name: 'n', type: 'N' } };
    expect(message(parseItem('{"id": {"B": "AAH+/w=="}}', keys))).toBe(
      'The item must hold its key attribute n of type N.',
    );
    expect(message(parseItem('{"id": {"S": "x"}, "n": {"N": "1"}}', keys))).toBe(
      'The item must hold its key attribute id of type B.',
    );
  });

  it('on edit, a key value changed → the key message; the same key passes', () => {
    const original: Item = { pk: { S: 'k' }, sk: { S: '1' } };
    expect(message(parseItem('{"pk": {"S": "k"}, "sk": {"S": "2"}}', KEYS, original))).toBe(KEY_CHANGED);
    expect(message(parseItem('{"pk": {"S": "j"}, "sk": {"S": "1"}}', KEYS, original))).toBe(KEY_CHANGED);
    expect(KEY_CHANGED).toBe('The key cannot change. Create a new item to copy this one.');
    expect(parseItem('{"pk": {"S": "k"}, "sk": {"S": "1"}, "a": {"S": "y"}}', KEYS, original).ok).toBe(true);
  });

  it('on edit, a Binary key compares by its bytes', () => {
    const keys: Keys = { partition: { name: 'id', type: 'B' } };
    const original: Item = { id: { B: new Uint8Array([0, 1, 254, 255]) } };
    expect(parseItem('{"id": {"B": "AAH+/w=="}}', keys, original).ok).toBe(true);
    expect(message(parseItem('{"id": {"B": "AAH+/g=="}}', keys, original))).toBe(KEY_CHANGED);
  });
});

describe('only the first failure is given', () => {
  it('a shape before base64 before the key before a changed key, in the text’s order', () => {
    const original: Item = { pk: { S: 'k' }, sk: { S: '1' } };
    expect(message(parseItem('{"sk": {"S": "2"}, "a": {"N": 1}, "b": {"B": "#"}}', KEYS, original))).toBe(
      NOT_VALUE('a'),
    );
    expect(message(parseItem('{"sk": {"S": "2"}, "b": {"B": "#"}, "a": {"N": 1}}', KEYS, original))).toBe(
      NOT_BASE64('b'),
    );
    expect(message(parseItem('{"sk": {"S": "2"}}', KEYS, original))).toBe(
      'The item must hold its key attribute pk of type S.',
    );
    expect(message(parseItem('{"pk": {"S": "k"}, "sk": {"S": "2"}}', KEYS, original))).toBe(KEY_CHANGED);
  });
});

describe('the emulator’s own rules are not checked here', () => {
  it.each([
    ['a number string that is no number', '"n": {"N": "twelve"}'],
    ['an empty set', '"ss": {"SS": []}'],
    ['a set with a member twice', '"ss": {"SS": ["a", "a"]}'],
    ['an empty binary set member', '"bs": {"BS": [""]}'],
  ])('%s passes', (_name, rest) => {
    expect(parseItem(withKey(rest), KEYS).ok).toBe(true);
  });

  it('an empty key value passes, String and Binary', () => {
    expect(parseItem('{"pk": {"S": ""}, "sk": {"S": ""}}', KEYS).ok).toBe(true);
    expect(parseItem('{"id": {"B": ""}}', { partition: { name: 'id', type: 'B' } }).ok).toBe(true);
  });
});

// probe-1 §2's item, as the editor's text: key attributes first, the others in code point order, two-space indented.
const EVERY_TYPE_TEXT = `{
  "pk": {
    "S": "c1"
  },
  "sk": {
    "S": "o#001"
  },
  "b": {
    "B": "aGVsbG8="
  },
  "bs": {
    "BS": [
      "aGk="
    ]
  },
  "l": {
    "L": [
      {
        "S": "a"
      },
      {
        "N": "2"
      }
    ]
  },
  "m": {
    "M": {
      "a": {
        "S": "x"
      },
      "nested": {
        "M": {
          "z": {
            "N": "1"
          }
        }
      }
    }
  },
  "n": {
    "N": "12.50"
  },
  "ns": {
    "NS": [
      "1",
      "2"
    ]
  },
  "nul": {
    "NULL": true
  },
  "s": {
    "S": "text"
  },
  "ss": {
    "SS": [
      "a",
      "b"
    ]
  },
  "t": {
    "BOOL": true
  }
}`;

const bytes = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));

const EVERY_TYPE_ITEM: Item = {
  pk: { S: 'c1' },
  sk: { S: 'o#001' },
  b: { B: bytes('hello') },
  bs: { BS: [bytes('hi')] },
  l: { L: [{ S: 'a' }, { N: '2' }] },
  m: { M: { a: { S: 'x' }, nested: { M: { z: { N: '1' } } } } },
  n: { N: '12.50' },
  ns: { NS: ['1', '2'] },
  nul: { NULL: true },
  s: { S: 'text' },
  ss: { SS: ['a', 'b'] },
  t: { BOOL: true },
};

describe('the every-type item', () => {
  it('its text → the client’s map, B and BS as bytes', () => {
    const parsed = parseItem(EVERY_TYPE_TEXT, KEYS);
    expect(parsed).toEqual({ ok: true, item: EVERY_TYPE_ITEM });
    const item = parsed.ok ? parsed.item : {};
    expect(item.b?.B).toBeInstanceOf(Uint8Array);
    expect(item.bs?.BS?.[0]).toBeInstanceOf(Uint8Array);
  });

  it('that map → the same text again, whatever order the map came in', () => {
    const reversed = Object.fromEntries(Object.entries(EVERY_TYPE_ITEM).reverse()) as Item;
    expect(itemText(reversed, KEYS)).toBe(EVERY_TYPE_TEXT);
    const parsed = parseItem(itemText(EVERY_TYPE_ITEM, KEYS), KEYS);
    expect(parsed.ok && itemText(parsed.item, KEYS)).toBe(EVERY_TYPE_TEXT);
  });

  it('names are ordered by code point, also names that look like numbers', () => {
    const item: Record<string, AttributeValue> = {
      pk: { S: 'k' },
      b: { S: '1' },
      '10': { S: '2' },
      B: { S: '3' },
      '😀': { S: '4' },
      '￿': { S: '5' },
    };
    const text = itemText(item, { partition: { name: 'pk', type: 'S' } });
    const order = [...text.matchAll(/^ {2}"(.*)": \{$/gmu)].map((match) => match[1]);
    expect(order).toEqual(['pk', '10', 'B', 'b', '￿', '😀']);
  });
});

describe('"Create item"’s text', () => {
  it('the key attributes with empty values of their types, two-space indented', () => {
    expect(newItemText({ partition: { name: 'pk', type: 'S' }, sort: { name: 'n', type: 'N' } })).toBe(
      '{\n  "pk": {\n    "S": ""\n  },\n  "n": {\n    "N": ""\n  }\n}',
    );
    expect(newItemText({ partition: { name: 'id', type: 'B' } })).toBe('{\n  "id": {\n    "B": ""\n  }\n}');
  });
});
