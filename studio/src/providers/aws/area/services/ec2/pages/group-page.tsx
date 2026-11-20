import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal, type TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { DeleteGroupDialog, type GroupTarget } from '../components/delete-group-dialog';
import { DeleteRuleDialog } from '../components/delete-rule-dialog';
import {
  addRuleHref,
  ADD_RULE_TITLE,
  NONE,
  securityGroupHref,
  SECURITY_GROUPS_PATH,
  SECURITY_GROUPS_WORD,
} from '../format';
import { revokeOperation, type SecurityGroup, type SecurityGroupRule } from '../group-api';
import { DEFAULT_GROUP_NAME, directionText, peerText, portRangeText, protocolText } from '../group-format';
import { useDeleteRule, useRuleListing, useSecurityGroup } from '../group-queries';

// A security group's page, S6 (issue 553, design task 4): read by `GroupIds`, so an id the emulator does not hold is
// "Security group not found", and its rules a page of `DescribeSecurityGroupRules` at a time, inbound and outbound in
// one table; a failed read of the rules fails the "Rules" section alone. "Delete" of the group leads to S4 with its
// result; "Delete" of a rule reads the rules again.

const RULES_DESCRIPTION = 'The inbound and outbound rules of this group.';
const SELECT_ONE_RULE = 'Select one rule.';
const DEFAULT_REASON = 'The default security group cannot be deleted.';

function Details({ group }: { group: SecurityGroup }) {
  return (
    <Container header={<Header variant="h2">Security group details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Security group details"
        items={[
          { label: 'Group ID', value: <CopyValue label="Group ID" value={group.id} kind="name" none={NONE} /> },
          { label: 'Name', value: <ValueText kind="name" value={group.name} none={NONE} /> },
          { label: 'Description', value: <ValueText kind="text" value={group.description} none={NONE} /> },
          { label: 'VPC ID', value: <ValueText kind="name" value={group.vpcId} none={NONE} /> },
          { label: 'ARN', value: <CopyValue label="ARN" value={group.arn} kind="address" none={NONE} /> },
        ]}
      />
    </Container>
  );
}

interface RulesProps {
  group: SecurityGroup;
  listing: TokenListing<SecurityGroupRule>;
  connection: AreaConnection;
}

function Rules({ group, listing, connection }: RulesProps) {
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const remove = useDeleteRule(connection.engineOrigin);
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<SecurityGroupRule>();
  const [pending, setPending] = useState(false);
  const { items, failure, refresh, currentPage, goToPage } = listing;
  const rows = items ?? [];
  const selected = rows.find((row) => row.id === selectedId);

  const handleConfirm = () => {
    if (deleting === undefined || pending) {
      return;
    }
    const rule = deleting;
    const signal = pageSignal();
    setPending(true);
    remove(group.id, rule, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        setDeleting(undefined);
        setSelectedId(undefined);
        flash.show([{ type: 'success', content: `Deleted the rule ${rule.id}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setDeleting(undefined);
        flash.show([
          actionFailureItem(
            failureOf(error, revokeOperation(rule.egress)),
            `Deleting the rule ${rule.id}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  const columns: TableProps.ColumnDefinition<SecurityGroupRule>[] = [
    { id: 'direction', header: 'Direction', cell: (rule) => <ValueText kind="fixed" value={directionText(rule)} /> },
    {
      id: 'protocol',
      header: 'Protocol',
      cell: (rule) => <ValueText kind="fixed" value={protocolText(rule.protocol)} none={NONE} />,
    },
    { id: 'ports', header: 'Port range', cell: (rule) => <ValueText kind="fixed" value={portRangeText(rule)} /> },
    {
      id: 'peer',
      header: 'Source or destination',
      cell: (rule) =>
        rule.peer?.kind === 'group' ? (
          <Link href={securityGroupHref(rule.peer.value)} onFollow={handleFollow}>
            <ValueText kind="name" value={rule.peer.value} />
          </Link>
        ) : (
          <ValueText kind="name" value={peerText(rule)} none={NONE} />
        ),
    },
    {
      id: 'description',
      header: 'Description',
      cell: (rule) => <ValueText kind="text" value={rule.description} none={NONE} />,
    },
    { id: 'id', header: 'Rule ID', isRowHeader: true, cell: (rule) => <ValueText kind="name" value={rule.id} /> },
  ];

  let empty = null;
  if (failure !== undefined) {
    empty = <ReadFailure state={readFailureState(failure, connection, 'rules')} onRetry={refresh} />;
  } else if (items !== undefined && items.length === 0) {
    empty = listing.pastEnd ? (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No more rules
        </Box>
      </Box>
    ) : (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No rules
          </Box>
          <Box variant="p" color="inherit">
            This group has no rule.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={addRuleHref(group.id)} onFollow={handleFollow}>
            {ADD_RULE_TITLE}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <>
      <Table<SecurityGroupRule>
        variant="container"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{ selectionGroupLabel: 'Rule selection', itemSelectionLabel: (_, rule) => rule.id }}
        columnDefinitions={columns}
        wrapLines
        loading={failure === undefined && items === undefined}
        loadingText="Loading rules"
        empty={empty}
        header={
          <Header
            variant="h2"
            description={RULES_DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={selected === undefined}
                  disabledReason={selected === undefined ? SELECT_ONE_RULE : undefined}
                  ariaLabel="Delete rule"
                  onClick={() => {
                    if (selected !== undefined) {
                      setDeleting(selected);
                    }
                  }}
                >
                  Delete
                </Button>
                <Button href={addRuleHref(group.id)} onFollow={handleFollow}>
                  {ADD_RULE_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            Rules
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={items === undefined}
            ariaLabels={{
              nextPageLabel: 'Next page of rules',
              previousPageLabel: 'Previous page of rules',
              pageLabel: (page) => `Page ${String(page)} of rules`,
            }}
            onChange={({ detail }) => {
              setSelectedId(undefined);
              goToPage(detail.currentPageIndex);
            }}
          />
        }
      />
      <DeleteRuleDialog
        rule={deleting}
        groupName={group.name === '' ? group.id : group.name}
        pending={pending}
        onConfirm={handleConfirm}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
    </>
  );
}

/** "Security group not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Security group not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no security group with this ID.
          </Box>
          <Link href={SECURITY_GROUPS_PATH} onFollow={handleFollow}>
            View security groups
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/ec2/security-groups/group/{id}`: the group `id` and its rules, read on every opening and refresh. A failed
 * read is read again once the connection is connected again, so after an emulator restart the page shows "Security
 * group not found".
 */
export function GroupPage({ connection, params }: ScreenPageProps) {
  useShowsResources(SECURITY_GROUPS_WORD);
  const id = params['id'] ?? '';
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const reading = useSecurityGroup(connection.engineOrigin, id);
  const rules = useRuleListing(connection.engineOrigin, id);
  const [deleting, setDeleting] = useState<GroupTarget>();
  const { value: read, failure, refresh } = reading;
  const refreshRules = rules.refresh;
  const group = read?.found === true ? read.group : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'security group');

  const readAgain = useCallback(() => {
    refresh();
    refreshRules();
  }, [refresh, refreshRules]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (failure !== undefined || rules.failure !== undefined || wasDown)) {
      setWasDown(false);
      readAgain();
    }
  }

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={readAgain} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading security group</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (group === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Details group={group} />
        <Rules group={group} listing={rules} connection={connection} />
      </SpaceBetween>
    );
  }

  const name = group === undefined || group.name === '' ? undefined : group.name;
  const deleteReason = group?.name === DEFAULT_GROUP_NAME ? DEFAULT_REASON : undefined;

  const handleDeleted = (deleted: GroupTarget) => {
    setDeleting(undefined);
    flash.handOver(SECURITY_GROUPS_PATH, [{ type: 'success', content: `Deleted security group ${deleted.name}` }]);
  };

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={readAgain} />
                {group !== undefined && (
                  <Button
                    disabled={deleteReason !== undefined}
                    disabledReason={deleteReason}
                    ariaLabel="Delete security group"
                    onClick={() => {
                      if (deleteReason === undefined) {
                        setDeleting({ id: group.id, name: name ?? group.id });
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={name ?? id} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <DeleteGroupDialog
        group={deleting}
        connection={connection}
        onDeleted={handleDeleted}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
