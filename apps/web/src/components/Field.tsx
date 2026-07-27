import { useId, useState, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  /** Pass when wrapping a control that already owns an id (Select, input). */
  htmlFor?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode | ((ids: { id: string; describedBy?: string }) => ReactNode);
}

/**
 * Label + control + help, in one place.
 *
 * Every field previously repeated a `.field-label` and wired `htmlFor` by hand,
 * which is how three controls ended up unlabelled. Passing a render function
 * hands back the generated ids so a control cannot be rendered without them.
 */
export function Field({ label, htmlFor, hint, error, optional, children }: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {label}
        {optional ? <span className="optional-tag">optional</span> : null}
      </label>
      {typeof children === 'function' ? children({ id, describedBy }) : children}
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface FileDropProps {
  id?: string;
  accept?: string;
  label?: string;
  hint?: string;
  onFile: (file: File) => void | Promise<void>;
}

/**
 * A styled replacement for `<input type="file">`, which browsers render with
 * unstyleable native chrome. The real input stays in the DOM and keeps its
 * keyboard behaviour; the label is what people see and drop onto.
 */
export function FileDrop({ id, accept, label = 'Choose a file', hint, onFile }: FileDropProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const [dragging, setDragging] = useState(false);

  const take = (file: File | undefined) => {
    if (file) void onFile(file);
  };

  return (
    <div className="file-field">
      <label
        className={dragging ? 'file-drop dragging' : 'file-drop'}
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files[0]);
        }}
      >
        <span className="file-drop-icon" aria-hidden="true">
          ↥
        </span>
        <span>
          {label}
          {hint ? <small> · {hint}</small> : null}
        </span>
        <input
          id={inputId}
          type="file"
          accept={accept}
          onChange={(event) => {
            take(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
