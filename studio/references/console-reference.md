# Console reference specs

A screen that mirrors the AWS console is built from a **reference spec**: a text file that lists what is on the
AWS screen and in what order. The spec is the design for that screen and the thing its structure score is
measured against.

Cloudscape is the design system of the AWS console, so components already look right. What a spec pins down is
structure: which screen exists, what it is called, which actions, columns, tabs, fields and steps it has.

## Where and who

- One file per screen: `studio/references/console/<service>/<screen>.yaml`.
- Written at the Screen stage, reviewed by `rev`, then fixed. A `worker` never edits a spec. A spec changes
  only by the `pm`, with the reason in `decisions.md`.

## Writing a spec

Read the AWS user guide for the service (console procedures, field names and their order) and the corresponding
view in StackPort (`DaviReisVieira/stackport`, MIT, a Cloudscape console for local emulators). Read StackPort for
what a view contains; never copy its code.

Do not write a spec from memory of what the console looks like. An item you cannot point to in one of those two
places is not in the spec.

When the owner supplies captures of the real AWS console, each affected spec is checked against them in an issue
of its own. Captures are never committed; only the spec is.

## Format

```yaml
screen: s3.bucket-list            # <service>.<screen>, unique
service: s3
kind: table                       # table | detail | form | wizard | dashboard
route: /s3/buckets                # the Studio route that renders it

breadcrumbs: [Amazon S3, Buckets]
header:
  title: General purpose buckets
  counter: true
  actions: [Copy ARN, Empty, Delete, Create bucket]   # in order
  primary_action: Create bucket
table:
  selection: single
  filter: text
  pagination: true
  columns: [Name, AWS Region, Creation date]          # in order
  empty:
    title: No buckets
    action: Create bucket

omitted:                          # on the AWS screen, deliberately not in Studio
  - item: header.actions[Copy ARN]
    reason: emulator returns 501 for the operation behind it
```

Other kinds use the same idea with their own blocks: `tabs` and `sections` (each with `fields`) for `detail`;
`sections` with `fields` (label, control, required, constraint text) for `form`; `steps` (each with
`sections`) for `wizard`. Every list that has a visible order is written in that order.

`omitted` is for parts of the AWS screen Studio leaves out on purpose. Each needs a reason that can be checked:
the emulator does not implement it, or it has no meaning without a real account (billing, cross-account,
Region pickers). "Not built yet" is not a reason; that is a failing item.

## Structure score

Computed from the running app, not from the code.

1. Open the spec's `route` in the built app at 1280x800 against a seeded emulator, and take the accessibility
   tree (roles and accessible names) of the page.
2. Every leaf of the spec is one **item**: a breadcrumb, the title, each action, each column, each tab, each
   field label, each step. Each ordered list adds one more item for its order.
3. An item **matches** when an element with the expected role and the same accessible name (trimmed, case
   insensitive) is present; an order item matches when the matched elements appear in the spec's order.
4. Items under `omitted` are removed from the total.

```
structure score = matched items / (all items - omitted items) x 100
```

- The report lists every unmatched item, and separately every action, column, tab or field found on the screen
  that the spec does not have.
- The same build, seed and spec always give the same score.

Pass line and what happens below it: `references/critique.md`.

## What a spec does not cover

Color, spacing and typography (Cloudscape tokens decide those), responsive behavior, and the content of data.
A structure score says the screen has the same parts as the reference. It does not say the screen is good; the
impeccable critique does that.
