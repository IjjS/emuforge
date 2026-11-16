import './language-control.css';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

import { useLanguage } from '../i18n/language-context';
import { CheckIcon, ExpandIcon, GlobeIcon } from './icons';

/** How long the letters typed in the menu make one search (type-ahead). */
const TYPE_AHEAD_MS = 500;

/** One option of the menu: a language by its tag, or `null` for "Browser language". */
interface Option {
  readonly tag: string | null;
  /** What type-ahead matches: the option's label, a language's own name. */
  readonly label: string;
}

/** The index of the option after `from` whose label starts with `query`, wrapping; `-1` for none. */
function typeAheadIndex(options: readonly Option[], from: number, query: string): number {
  for (let step = 0; step < options.length; step++) {
    const index = (from + step) % options.length;
    const option = options[index];
    if (option !== undefined && option.label.toLocaleLowerCase(option.tag ?? undefined).startsWith(query)) {
      return index;
    }
  }
  return -1;
}

/**
 * Loads the faces of every language's own name before the menu first opens (crit revised r2 P3), so a name in
 * another script does not swap faces in front of the user. The face of each is whatever Studio's stylesheet gives an
 * element of that `lang` in the control; a probe without text reads it and is removed at once.
 */
function loadFaces(holder: HTMLElement, names: readonly { tag: string; name: string }[]): void {
  if (!('fonts' in document)) {
    return;
  }
  for (const { tag, name } of names) {
    const probe = document.createElement('span');
    probe.lang = tag;
    probe.hidden = true;
    holder.append(probe);
    const style = getComputedStyle(probe);
    const font = `${style.fontStyle} ${style.fontWeight} 15px ${style.fontFamily}`;
    probe.remove();
    document.fonts.load(font, name).catch(() => undefined);
  }
}

/**
 * Swallows the rest of a press that only put the menu away (issue 32, R2): its mouse events, so focus stays on the
 * control and nothing under the press acts on a button going down, and the click or auxiliary click that completes
 * it, so no link is followed, in this tab or another, and no button runs. The context menu of a secondary press is
 * the browser's and is left alone. The next press, a key, or a press the browser cancelled (a touch that became a
 * scroll) ends it, so nothing is left pending that could swallow a later press (R2.3). Returns the function that
 * ends it early.
 */
function swallowRestOfPress(): () => void {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const complete = (event: Event) => {
    swallow(event);
    end();
  };
  const listeners: [string, (event: Event) => void][] = [
    ['mousedown', swallow],
    ['pointerup', swallow],
    ['mouseup', swallow],
    ['click', complete],
    ['auxclick', complete],
    [
      'pointerdown',
      () => {
        end();
      },
    ],
    [
      'pointercancel',
      () => {
        end();
      },
    ],
    [
      'keydown',
      () => {
        end();
      },
    ],
  ];
  function end() {
    for (const [type, listener] of listeners) {
      window.removeEventListener(type, listener, true);
    }
  }
  // Added while the press's own `pointerdown` is dispatched at the window: they first hear what comes after it.
  for (const [type, listener] of listeners) {
    window.addEventListener(type, listener, true);
  }
  return end;
}

/**
 * The language control of Studio's bar (requirement R3): a button that names the current language and opens a menu
 * of "Browser language" and every language by its own name, in the order of `Intl.Collator('und')`. The menu opens
 * with focus on the checked option; Up and Down wrap, Home and End go to the ends, letters go to the next option
 * whose name starts with them; Esc and Tab close it without a change; choosing an option applies it and puts focus
 * back on the control (R2.6). A press outside it only puts the menu away (issue 32, R2); at 480 and below a veil,
 * decoration with no role, name or text, lies over the page under the bar while the menu is open (issue 32, R3).
 */
export function LanguageControl() {
  const { t, tag, choice, browser, languages, choose } = useLanguage();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const holder = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const endSwallow = useRef<(() => void) | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const typed = useRef({ text: '', at: 0 });
  const facesLoaded = useRef(false);

  const sorted = useMemo(() => {
    const collator = new Intl.Collator('und');
    return [...languages].sort((a, b) => collator.compare(a.name, b.name));
  }, [languages]);
  const browserLabel = t('language.browser');
  const options: Option[] = [
    { tag: null, label: browserLabel },
    ...sorted.map((language) => ({ tag: language.tag, label: language.name })),
  ];
  const checked = Math.max(
    0,
    options.findIndex((option) => option.tag === choice),
  );
  const nameOf = (of: string) => languages.find((language) => language.tag === of)?.name ?? of;

  // Opening puts focus on the checked option, so a reflexive Enter does not reset a stored choice (crit r2 P2).
  useLayoutEffect(() => {
    if (open) {
      items.current[checked]?.focus();
    }
    // Only on opening: a change of the checked option closes the menu first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A press anywhere outside the control and its menu, the veil included, closes the menu, puts focus on the control
  // as Esc does, and does nothing else (issue 32, R2): no element under it hears the press or its click.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (trigger.current?.contains(target) === true || menu.current?.contains(target) === true)
      ) {
        return;
      }
      event.stopPropagation();
      endSwallow.current?.();
      endSwallow.current = swallowRestOfPress();
      trigger.current?.focus();
      setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open]);

  // A press still being swallowed when the control goes away is let go with it.
  useEffect(
    () => () => {
      endSwallow.current?.();
    },
    [],
  );

  const handleFirstReach = () => {
    if (facesLoaded.current || holder.current === null) {
      return;
    }
    facesLoaded.current = true;
    loadFaces(holder.current, languages);
  };

  const close = (focusControl: boolean) => {
    if (focusControl) {
      trigger.current?.focus();
    }
    setOpen(false);
  };

  const handleChoose = (option: Option) => {
    close(true);
    choose(option.tag);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const focusItem = (index: number) => {
    items.current[(index + options.length) % options.length]?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = items.current.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case 'ArrowDown':
        focusItem(at + 1);
        break;
      case 'ArrowUp':
        focusItem(at - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(options.length - 1);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        // The browser's own Tab then moves on from the control, as from any stop of the bar.
        close(true);
        return;
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === ' ') {
          return;
        }
        const now = Date.now();
        const sofar = now - typed.current.at > TYPE_AHEAD_MS ? '' : typed.current.text;
        const text = (sofar + event.key).toLocaleLowerCase();
        typed.current = { text, at: now };
        // One letter, or the same letter again, moves on to the next match; more letters refine the current one.
        const repeated = [...text].every((letter) => letter === text[0]);
        const found = repeated
          ? typeAheadIndex(options, at + 1, text[0] ?? '')
          : typeAheadIndex(options, Math.max(at, 0), text);
        if (found >= 0) {
          focusItem(found);
        }
      }
    }
    event.preventDefault();
  };

  /** Focus that leaves the control for another element closes the menu. */
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  };

  const ownName = nameOf(tag);

  return (
    <div ref={holder} className="st-lang" onBlur={handleBlur}>
      <button
        ref={trigger}
        type="button"
        className="st-lang-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('language.control', { name: ownName })}
        onClick={() => {
          setOpen((was) => !was);
        }}
        onKeyDown={handleTriggerKeyDown}
        onPointerEnter={handleFirstReach}
        onFocus={handleFirstReach}
      >
        <GlobeIcon />
        <span className="st-lang-name" lang={tag}>
          {ownName}
        </span>
        <ExpandIcon className="st-lang-chev" />
      </button>
      {open && <div className="st-lang-veil" aria-hidden="true" />}
      {open && (
        <div
          ref={menu}
          id={menuId}
          className="st-lang-menu"
          role="menu"
          aria-label={t('language.menu')}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option, index) => (
            <OptionItem
              key={option.tag ?? ''}
              ref={(element) => {
                items.current[index] = element;
              }}
              option={option}
              checked={index === checked}
              browser={option.tag === null ? { tag: browser, name: nameOf(browser) } : undefined}
              browserNamed={t('language.browserNamed', { name: nameOf(browser) })}
              onChoose={handleChoose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface OptionItemProps {
  ref: (element: HTMLButtonElement | null) => void;
  option: Option;
  checked: boolean;
  /** For "Browser language": the language the browser's languages resolve to, shown under its label. */
  browser: { tag: string; name: string } | undefined;
  /** The accessible name of "Browser language": its label and that language's name, as the catalogue joins them. */
  browserNamed: string;
  onChoose: (option: Option) => void;
}

/** One `menuitemradio`: its check, then its label; a language's own name carries that language's `lang` (R1.3). */
function OptionItem({ ref, option, checked, browser, browserNamed, onChoose }: OptionItemProps) {
  return (
    <>
      <button
        ref={ref}
        type="button"
        role="menuitemradio"
        className="st-lang-item"
        aria-checked={checked}
        tabIndex={-1}
        lang={option.tag ?? undefined}
        aria-label={browser === undefined ? undefined : browserNamed}
        onClick={() => {
          onChoose(option);
        }}
      >
        <CheckIcon />
        <span>{option.label}</span>
        {browser !== undefined && (
          <span className="st-lang-sub" lang={browser.tag}>
            {browser.name}
          </span>
        )}
      </button>
      {option.tag === null && <div className="st-lang-sep" role="separator" />}
    </>
  );
}
