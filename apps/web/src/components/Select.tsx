import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

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
  /** Force the search field on or off. Defaults to on for long lists. */
  searchable?: boolean;
  /**
   * Let the typed query be committed as a value of its own.
   *
   * For providers whose catalogue is not exhaustive — the Claude CLI publishes
   * aliases but accepts a full model name, and Codex forwards any id — a picker
   * limited to the listed entries would make pinning a specific version
   * impossible.
   */
  allowCustom?: boolean;
  /** Shown under a custom entry to explain what committing it does. */
  customHint?: string;
}

/** Above this many options, scrolling stops being a reasonable way to choose. */
const SEARCH_THRESHOLD = 8;

/**
 * A listbox that replaces the native `<select>`.
 *
 * Native selects render as OS chrome that ignores the app's palette and — the
 * reason this exists — cannot show a description per option. Choosing a
 * workflow or a model is exactly the case where the label alone ("Critical
 * Feature", "Opus 5 1M") does not tell you what you are picking.
 *
 * Follows the ARIA combobox pattern. Whichever element owns focus — the trigger
 * for short lists, the search field for long ones — carries `role="combobox"`
 * and points at the active option via `aria-activedescendant`, so options never
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
  searchable,
  allowCustom = false,
  customHint = 'Use exactly as typed',
}: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;
  const searchId = `${triggerId}-search`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Typeahead buffer for the no-search path. A ref, not state: typing must not
  // trigger a render.
  const typeahead = useRef({ query: '', at: 0 });

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const selected = options.find((option) => option.value === value);

  // Matching the id as well as the label matters here: model ids are what the
  // provider documents, so "opus-5-high" should find its entry.
  const visible = useMemo(() => {
    const typed = query.trim();
    const needle = typed.toLowerCase();
    const matches = needle
      ? options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            option.value.toLowerCase().includes(needle) ||
            option.description?.toLowerCase().includes(needle),
        )
      : options;

    // Offered last, so typing a prefix of a real entry still lands on that
    // entry first and the custom escape hatch is a deliberate reach.
    if (allowCustom && typed && !options.some((option) => option.value === typed)) {
      return [...matches, { value: typed, label: `Use “${typed}”`, description: customHint }];
    }
    return matches;
  }, [allowCustom, customHint, options, query]);

  const openList = useCallback(() => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
  }, [disabled, options, value]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = visible[index];
      if (!option) return;
      onChange(option.value);
      close(true);
    },
    [close, onChange, visible],
  );

  // Pointer-down rather than click: a drag that starts inside and ends outside
  // would otherwise leave the list open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (open && withSearch) searchRef.current?.focus();
  }, [open, withSearch]);

  // Keep the keyboard cursor in view when arrowing past the visible window.
  // Cosmetic, and absent in jsdom, so a missing implementation must not take
  // the control down with it.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const move = (index: number) => {
    if (!visible.length) return;
    setActiveIndex((index + visible.length) % visible.length);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else move(activeIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else move(activeIndex - 1);
        return;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActiveIndex(visible.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        if (open) commit(activeIndex);
        else openList();
        return;
      case ' ':
        // Space types a space in the search field; only the closed trigger
        // should treat it as "open".
        if (open && withSearch) return;
        event.preventDefault();
        if (open) commit(activeIndex);
        else openList();
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        if (open) close(false);
        return;
      default:
        break;
    }

    // Typeahead only exists for the short-list path; the long-list path has a
    // real search field doing the same job better.
    if (withSearch) return;
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;

    const at = Date.now();
    const buffer = at - typeahead.current.at > 800 ? '' : typeahead.current.query;
    const needle = (buffer + event.key).toLowerCase();
    typeahead.current = { query: needle, at };

    const from = (open ? activeIndex : options.findIndex((o) => o.value === value)) + 1;
    const ordered = [...options.slice(from), ...options.slice(0, Math.max(from, 0))];
    const hit = ordered.find((option) => option.label.toLowerCase().startsWith(needle));
    if (!hit) return;
    event.preventDefault();
    const index = options.indexOf(hit);
    if (open) setActiveIndex(index);
    else {
      onChange(hit.value);
      void index;
    }
  };

  const listMarkup = (
    <ul className="select-popover-list" id={listboxId} role="listbox" ref={listRef}>
      {visible.length === 0 ? (
        <li className="select-empty">
          {options.length === 0 ? 'Nothing to choose from yet.' : `No match for “${query}”.`}
        </li>
      ) : (
        visible.map((option, index) => (
          <li
            key={option.value}
            id={`${listboxId}-${index}`}
            role="option"
            aria-selected={option.value === value}
            className={[
              'select-option',
              index === activeIndex ? 'active' : '',
              option.value === value ? 'selected' : '',
              // The custom entry is the one value not drawn from the catalogue.
              allowCustom && !options.some((item) => item.value === option.value) ? 'custom' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            // Pointer-down would steal focus from whichever element owns it,
            // breaking aria-activedescendant before the click lands.
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
  );

  const activeDescendant =
    open && activeIndex >= 0 && activeIndex < visible.length
      ? `${listboxId}-${activeIndex}`
      : undefined;

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className="select-trigger"
        // With a search field open, that field is the combobox; the trigger
        // must not also claim the role.
        role={withSearch ? undefined : 'combobox'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={withSearch ? undefined : activeDescendant}
        aria-labelledby={labelledBy ? `${labelledBy} ${triggerId}` : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={withSearch ? undefined : onKeyDown}
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
        <div className="select-popover">
          {withSearch ? (
            <div className="select-search">
              <input
                id={searchId}
                ref={searchRef}
                type="text"
                role="combobox"
                autoComplete="off"
                placeholder="Type to filter…"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeDescendant}
                aria-labelledby={labelledBy}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onKeyDown}
              />
              <small>
                {visible.length} of {options.length}
              </small>
            </div>
          ) : null}
          {listMarkup}
        </div>
      ) : null}
    </div>
  );
}
