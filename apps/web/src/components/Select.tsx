import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Shown under the label, in the trigger and in the list. */
  description?: string;
}

export interface SelectProps {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** id of the element labelling this control, usually a `.field-label`. */
  labelledBy?: string;
  describedBy?: string;
}

/**
 * A listbox that replaces the native `<select>`.
 *
 * Native selects render as OS chrome that ignores the app's palette, and — the
 * reason this exists — they cannot show a description per option. Choosing a
 * workflow or a document authority is exactly the case where the label alone
 * ("Critical Feature", "Approved plan") does not tell you what you are picking.
 *
 * Follows the ARIA combobox pattern: the trigger owns focus throughout and
 * points at the active option via `aria-activedescendant`, so options never
 * take focus themselves.
 */
export function Select({
  id,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  disabled = false,
  required = false,
  labelledBy,
  describedBy,
}: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Typeahead buffer. A ref, not state: typing must not trigger a render.
  const typeahead = useRef({ query: '', at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openList = useCallback(
    (index?: number) => {
      if (disabled) return;
      setOpen(true);
      setActiveIndex(index ?? (selectedIndex >= 0 ? selectedIndex : 0));
    },
    [disabled, selectedIndex],
  );

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      onChange(option.value);
      setOpen(false);
    },
    [onChange, options],
  );

  // Pointer-down rather than click: a click that starts inside and ends outside
  // would otherwise leave the list open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the keyboard cursor in view when arrowing past the visible window.
  // Purely cosmetic, and absent in jsdom, so a missing implementation must not
  // take the control down with it.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const option = listRef.current?.children[activeIndex];
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const moveTo = (index: number) => {
    if (!options.length) return;
    const wrapped = (index + options.length) % options.length;
    if (open) setActiveIndex(wrapped);
    else commit(wrapped);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else moveTo(activeIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else moveTo(activeIndex - 1);
        return;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) commit(activeIndex);
        else openList();
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        break;
    }

    // Typeahead: printable keys jump to the next option starting with what was
    // typed. The buffer resets after a pause so a new word starts a new search.
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    const now = Date.now();
    const buffer = now - typeahead.current.at > 800 ? '' : typeahead.current.query;
    const query = (buffer + event.key).toLowerCase();
    typeahead.current = { query, at: now };

    const from = (open ? activeIndex : selectedIndex) + 1;
    const ordered = [...options.slice(from), ...options.slice(0, Math.max(from, 0))];
    const hit = ordered.find((option) => option.label.toLowerCase().startsWith(query));
    if (!hit) return;
    event.preventDefault();
    const index = options.indexOf(hit);
    if (open) setActiveIndex(index);
    else commit(index);
  };

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        className="select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-labelledby={labelledBy ? `${labelledBy} ${triggerId}` : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'select-value' : 'select-value select-placeholder'}>
          <b>{selected?.label ?? placeholder}</b>
          {selected?.description ? <small>{selected.description}</small> : null}
        </span>
        <span className="select-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <ul className="select-popover" id={listboxId} role="listbox" ref={listRef}>
          {options.length === 0 ? (
            <li className="select-empty">Nothing to choose from yet.</li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={[
                  'select-option',
                  index === activeIndex ? 'active' : '',
                  option.value === value ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                // Pointer-down would steal focus from the trigger before the
                // click lands, breaking aria-activedescendant.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <b>{option.label}</b>
                {option.description ? <small>{option.description}</small> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
