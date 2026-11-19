Issue-Id: 550
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|sns.screens|critique-refinements
Issue-Check-Ids:
Issue-Commit: 4d83a34569047383fcc3eae64d15771490d949b3

# Refine SNS's screens by the findings the critique of issue 536 left

> Identified against commit `4d83a34569047383fcc3eae64d15771490d949b3`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The impeccable critique of issue 536 scored SNS's screens five times (the topic page's two tabs 28/40 at round 3,
the topics list 28/40 at round 5; no P0 or P1 left). These P2 and P3 findings were not fixed in that issue: the
screens do their tasks, and each further fix would have brought one more critique and whole check. None breaks a
task.

Topics list (`pages/topic-list-page.tsx`, `queries.ts`):
- at 390 px the "ARN" column is 70 px wide, every part of an ARN breaks inside itself and a row is 259 to 319 px
  high (r4 P2 1, r5 P2 3);
- on a later page the counter counts that page's rows and reads as a total, "Topics (1)" on page 2 of 101 topics
  (r4 P2 2, r5 P2 2);
- the status of "Copy ARN" is inserted between "Refresh" and "Copy ARN" for about 5 s and moves the buttons; at 390
  "Delete" and "Create topic" wrap (r4 P2 3);
- "Refresh" blanks the table to "Loading topics" and drops the selection (r4 P3 1);
- after a delete, focus lands on the now disabled "Delete" (r4 P3 2);
- when a later page is found empty the list goes to page 1 without saying so (r5 P2 1);
- "Reading the topics" and "Loading topics" name one state two ways (r5 P3 4).

A topic's page (`pages/topic-page.tsx`, `components/subscriptions-tab.tsx`, `components/publish-tab.tsx`):
- "Result" ends at a link to the other tab although the read made at the publish holds the subscriptions; with none
  it still offers "See this topic's subscriptions" (r3 P2 1);
- at 390 "Delivery" is the last column, behind "Endpoint" and "Status" in the table's own scroll (r3 P2 2);
- "Allow delivery" is a header button behind a row selection, far from the "No permission" cell (r3 P2 3);
- "Sequence number" has no copy control while "Message ID" has (r3 P3 4);
- after a subscription is deleted the dialog unmounts with the selection and focus may fall to the body
  (unverified; r3 P3 5);
- an orphaned doc comment in `subscriptions-tab.tsx`, and `onTopicChanged` passed and declared but never used
  (r3 P3 6, P3 7).

"Create subscription" (`pages/create-subscription-page.tsx`):
- at the address of a topic the emulator does not hold, the description reads "Subscribes a queue or a function to
  missing." (r1 P2 4).

## Evidence

The critique's review files of issue 536, each finding with its file and line: `.pm/issue-536/review-final.md`
(r1), `review-final-r3.md`, `review-final-r4.md`, `review-final-r5.md` in the main checkout (summary
`.pm/archive/536.md`); its snapshots under `studio/.impeccable/critique/` of the worktree `emuforge-536`
(`2026-11-19T15-29-42Z__src-providers-aws-area-services-sns.md`,
`2026-11-19T16-13-49Z__ea-services-sns-pages-topic-list-page-tsx-8e6e648d.md`), with widths and heights measured on
the built app of `feat/536`. Why each was left: `.pm/issue-536/decisions.md`, "Review decisions", 2026-11-20.

## Steps to Reproduce

1. Start a fresh emulator and create 101 topics; open `/aws/sns/topics` at 390 px wide: the rows' height; go to
   page 2: the counter.
2. Select a topic, "Copy ARN": the buttons move while the status shows.
3. Open `/aws/sns/topics/topic/<an ARN the emulator does not hold>/subscribe`: the description's last word.
4. On a topic with a queue subscribed, "Publish" a message: "Result" lists no subscription.

## Expected

- Each finding above is fixed or recorded as not adopted with its reason, and the screens are critiqued once with no
  P0 or P1.
- No confirmed check of SNS changes what it proves.

## Out of scope

The findings recorded as not adopted in issue 536's `decisions.md` (the order of the columns as the requirement
gives it, the two "Delete" controls, the texts the requirement fixes). New tasks of SNS (their own issues).
