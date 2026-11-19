import './text-field.css';

import { useId, type ChangeEvent, type ReactNode, type Ref } from 'react';

import { FailedIcon } from './icons';

interface TextFieldProps {
  /** The field's visible label, which names it. */
  label: string;
  /** One line under the label that says what the field takes. */
  hint?: ReactNode;
  /** What is wrong with the value, shown beside the field and read with it; `undefined` while nothing is. */
  error?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** The field holds code (a name, an address): the code face, no spelling check, no automatic capital. */
  code?: boolean;
  /** An example of the value, shown while the field is empty. */
  placeholder?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A text field of Studio's: its label, a hint, the input and, when the value breaks a rule, the error under it in
 * `err` with its icon. The hint and the error describe the input; the input is marked invalid while there is an error.
 */
export function TextField({ label, hint, error, value, onChange, code = false, placeholder, ref }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? '' : hintId, error === undefined ? '' : errorId]
    .filter((part) => part !== '')
    .join(' ');
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };
  return (
    <div className={error === undefined ? 'st-field' : 'st-field invalid'}>
      <label htmlFor={id}>{label}</label>
      {hint !== undefined && (
        <p id={hintId} className="st-field-hint">
          {hint}
        </p>
      )}
      <input
        ref={ref}
        id={id}
        type="text"
        className={code ? 'st-input code' : 'st-input'}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        aria-invalid={error === undefined ? undefined : 'true'}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        autoComplete="off"
        autoCapitalize={code ? 'off' : undefined}
        autoCorrect={code ? 'off' : undefined}
        spellCheck={code ? false : undefined}
      />
      {error !== undefined && (
        <p id={errorId} className="st-field-error">
          <FailedIcon />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
