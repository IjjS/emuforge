import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState, type FocusEvent } from 'react';
import { useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ScreenPageProps } from '../../../screens';
import { apiChoices } from '../api-choices';
import type { ApiRow } from '../apis-api';
import { PagedChoice } from '../components/paged-choice';
import { createApiPath, restApiPath, v2ApiPath } from '../format';

export type ApiChoiceDestination =
  { model: 'rest'; part: 'resources' | 'stages' } | { model: 'v2'; part: 'routes' | 'integrations' | 'stages' };

interface ChooseApiPageProps extends ScreenPageProps {
  name: string;
  destination: ApiChoiceDestination;
}

export function ChooseApiPage({ connection, name, destination: { model, part } }: ChooseApiPageProps) {
  useShowsResources('APIs');
  const navigate = useNavigate();
  const handleFollow = useFollow();
  const [selected, setSelected] = useState<ApiRow>();
  const [empty, setEmpty] = useState(false);
  const [opening, setOpening] = useState(0);
  const opened = useRef(false);
  const things = model === 'rest' ? 'REST APIs' : 'HTTP or WebSocket APIs';
  const source = apiChoices(connection.engineOrigin, model);

  const handleChoiceFocus = (event: FocusEvent<HTMLDivElement>) => {
    // Cloudscape moves focus into the dropdown on each open, even if the trigger kept focus after closing.
    const dropdown = event.target.closest('[role="dialog"]');
    if (dropdown === null || dropdown.contains(event.relatedTarget)) return;
    if (opened.current) setOpening((previous) => previous + 1);
    opened.current = true;
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`${name} belong to an API. Choose the API to open them.`}>
        {name}
      </Header>
      <Container>
        <SpaceBetween size="m">
          <FormField label="API">
            <div onFocusCapture={handleChoiceFocus}>
              <PagedChoice
                source={{
                  ...source,
                  key: [...source.key, opening],
                  read: async (endpoint, text, token, signal) => {
                    if (token === undefined) setEmpty(false);
                    const page = await source.read(endpoint, text, token, signal);
                    if (token === undefined && !signal.aborted) {
                      setEmpty(page.items.length === 0 && page.next === undefined);
                    }
                    return page;
                  },
                }}
                connection={connection}
                things={things}
                placeholder="Choose an API"
                value={selected}
                onChange={setSelected}
              />
            </div>
          </FormField>
          {empty ? (
            <Box textAlign="center">
              <SpaceBetween size="xs">
                <Box variant="strong">No {things}</Box>
                <Box variant="p">The emulator holds none.</Box>
                <Button href={createApiPath} onFollow={handleFollow}>
                  Create API
                </Button>
              </SpaceBetween>
            </Box>
          ) : (
            <Button
              variant="primary"
              disabled={selected === undefined}
              onClick={() => {
                if (selected === undefined) return;
                const path = model === 'rest' ? restApiPath : v2ApiPath;
                void navigate(path(selected.id, part));
              }}
            >
              Open
            </Button>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
