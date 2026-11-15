# Console reference specs

A screen that mirrors the AWS console is built from a **reference spec**: a text file that lists what is on the
AWS screen and in what order. The spec is the design for that screen and the thing its structure score is
measured against.

Such a screen is graded `console` and lives in the AWS area, at `/aws` and below (`studio/AGENTS.md`, "Two
layers"). Studio's own layer (the frame, Home, Studio's "Page not found") has no `console` screen and no spec; its
screens are designed per `critique.md` in Studio's own design system.

Inside the AWS area everything is Cloudscape, the design system of the AWS console, so components already look
right. What a spec pins down is structure: which screen exists, what it is called, which actions, columns, tabs,
fields and steps it has.

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
kind: table                       # table | detail | form | wizard
route: /aws/s3/buckets            # the Studio route that renders it, under the AWS area's /aws

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

`route` always starts with `/aws/`: the AWS area's segment followed by the service's route.

Other kinds use the same idea with their own blocks: `tabs` and `sections` (each with `fields`) for `detail`;
`sections` with `fields` (label, control, required, constraint text) for `form`; `steps` (each with `title` and
`sections`) and `submit` for `wizard`. Every list that has a visible order is written in that order.

A wizard has no `header`, `table`, `tabs` or top-level `sections`: the active step's title is the page heading.
Its `route` holds no `?` and no `#`, because the score adds the step to it:

```yaml
screen: iam.create-role
service: iam
kind: wizard
route: /aws/iam/roles/create

breadcrumbs: [IAM, Roles, Create role]
steps:                            # in order
  - title: Select trusted entity
    sections:                     # as in kind form
      - title: Trusted entity type
        fields: [Use case, Service]
  - title: Add permissions
    sections:
      - title: Permissions policies
  - title: Name, review, and create
submit: Create role               # the last step's primary button
```

A step is omitted as a whole (`steps[<title>]`), never by its title alone; an omitted step is not opened and not
part of the steps' order.

There is no `dashboard` kind. A dashboard screen (containers, each a header with key-value pairs or fields, as in
the AWS console's service dashboards) is written as `kind: detail` with `header` and `sections`.

`omitted` is for parts of the AWS screen Studio leaves out on purpose. Each needs a reason that can be checked:
the emulator does not implement it, or it has no meaning without a real account (billing, cross-account,
Region pickers). "Not built yet" is not a reason; that is a failing item.

## Structure score

Computed from the running app, not from the code, by `.pm/bin/pm-structure`.

1. Open the spec's `route` in the built app at 1280x800 against a seeded emulator, and take the accessibility
   tree (roles and accessible names) of the AWS area: everything under the area's root, its `AppLayout` with the
   breadcrumbs included. Studio's frame around the area is not part of the screen and is not scored. A spec with items that exist in only one data state
   (`table.empty`, which needs an empty table, or a `single` or `multi` `table.selection`, which needs rows) is
   scored in two runs of the same build: one against a seeded emulator and one against an empty one.
2. Every leaf of the spec is one **item**: a breadcrumb, the title, each action, each column, each tab, each
   field label, each step. Each ordered list adds one more item for its order.
3. An item **matches** when an element with the expected role and the same accessible name (trimmed, case
   insensitive) is present; an order item matches when the matched elements appear in the spec's order.
4. Items under `omitted` are removed from the total, and so are the items that do not apply to the run's state
   (`table.empty` in the seeded run, a `single` or `multi` `table.selection` in the empty run).

```
structure score = matched items / (all items - omitted items - not-applicable items) x 100
```

- With two runs, each run has its own score, and the screen passes only when both runs pass.

A wizard is opened once per shown step (its steps that are not omitted, in order): step `k` is the spec's route
opened with `?step=<k>`, each a fresh page, nothing on it operated (no click, no typing). A Studio wizard screen
therefore opens at step `k` when its route is opened with `?step=<k>`; one that ignores the parameter shows its
first step on every page and its later steps come out unmatched. Each step's items are scored on that step's tree
only: its title (a heading, critical), its sections and fields; `submit` (a button, critical) on the last shown
step's tree; the breadcrumbs and the steps' order (each step's entry in the step navigation) on step 1's tree.
Every line of the report names the step its item was scored on.

- The report lists every unmatched item, and separately every action, column, tab or field found on the screen
  that the spec does not have.
- The same build, seed and spec always give the same score.

Pass line and what happens below it: `references/critique.md`.

## What a spec does not cover

Color, spacing and typography (Cloudscape tokens decide those inside the AWS area), responsive behavior, and the
content of data. A structure score says the screen has the same parts as the reference. It does not say the
screen is good; the impeccable critique does that.
