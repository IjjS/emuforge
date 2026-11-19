import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { useLanguage } from '../../i18n/language-context';
import { ActionButton } from '../../ui/action-button';
import { Panel } from '../../ui/section';
import { TextField } from '../../ui/text-field';
import type { AddField } from './refusal-text';
import { endpointProblem, nameProblem } from './validate';

/** How an add ended, as the form needs it: added (it empties), refused (it says why, where), or neither. */
export type AddOutcome = { kind: 'added' } | { kind: 'refused'; field: AddField; text: ReactNode } | { kind: 'kept' };

interface AddConnectionFormProps {
  /** Sends the add; resolves once the page has read its list again and said what happened. */
  onAdd: (name: string, endpoint: string) => Promise<AddOutcome>;
}

/** An example endpoint, the same in every language: an address is not translated. */
const ENDPOINT_EXAMPLE = 'https://127.0.0.1:<port>';

/**
 * "Add connection" (requirement R4): Name and Endpoint, checked against the five rules before anything is sent; a
 * refusal is shown beside the field it concerns, or under the form, with what was typed kept and focus on that field.
 */
export function AddConnectionForm({ onAdd }: AddConnectionFormProps) {
  const { t } = useLanguage();
  const headingId = useId();
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [nameError, setNameError] = useState<ReactNode>();
  const [endpointError, setEndpointError] = useState<ReactNode>();
  const [formError, setFormError] = useState<ReactNode>();
  const [adding, setAdding] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const endpointInput = useRef<HTMLInputElement>(null);

  /** A field's error is about the value it was given: a new value clears it until the next "Add connection". */
  const handleNameChange = (value: string) => {
    setName(value);
    setNameError(undefined);
  };

  const handleEndpointChange = (value: string) => {
    setEndpoint(value);
    setEndpointError(undefined);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (adding) {
      return;
    }
    const nameKey = nameProblem(name);
    const endpointKey = endpointProblem(endpoint);
    setNameError(nameKey === undefined ? undefined : t(nameKey));
    setEndpointError(endpointKey === undefined ? undefined : t(endpointKey));
    setFormError(undefined);
    if (nameKey !== undefined || endpointKey !== undefined) {
      (nameKey !== undefined ? nameInput : endpointInput).current?.focus();
      return;
    }
    setAdding(true);
    void onAdd(name, endpoint).then((outcome) => {
      setAdding(false);
      if (outcome.kind === 'added') {
        setName('');
        setEndpoint('');
      } else if (outcome.kind === 'refused') {
        if (outcome.field === 'name') {
          setNameError(outcome.text);
          nameInput.current?.focus();
        } else if (outcome.field === 'endpoint') {
          setEndpointError(outcome.text);
          endpointInput.current?.focus();
        } else {
          setFormError(outcome.text);
        }
      }
    });
  };

  return (
    <section className="st-section" aria-labelledby={headingId}>
      <div className="st-section-head">
        <h2 id={headingId}>{t('connections.add.title')}</h2>
      </div>
      <Panel>
        <form className="st-add-form" noValidate onSubmit={handleSubmit}>
          <div className="st-add-fields">
            <TextField
              ref={nameInput}
              code
              label={t('connections.add.name')}
              hint={t('connections.add.nameHint')}
              error={nameError}
              value={name}
              onChange={handleNameChange}
            />
            <TextField
              ref={endpointInput}
              code
              label={t('connections.add.endpoint')}
              hint={<code className="st-code">{ENDPOINT_EXAMPLE}</code>}
              placeholder={ENDPOINT_EXAMPLE}
              error={endpointError}
              value={endpoint}
              onChange={handleEndpointChange}
            />
          </div>
          <div className="st-add-end">
            <ActionButton type="submit" busy={adding}>
              {t(adding ? 'connections.add.adding' : 'connections.add.submit')}
            </ActionButton>
          </div>
          {formError !== undefined && (
            <p className="st-add-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </Panel>
    </section>
  );
}
