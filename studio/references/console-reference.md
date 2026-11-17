# Console reference specs

A screen that follows the information structure and flow of an AWS console screen is built from a **reference
spec**: a text file that lists the parts of the AWS screen that Studio shows, their labels and their order. The
spec is the design for that screen and the thing its structure score is measured against. It is written to the AWS
screen policy (`studio/AGENTS.md`, "AWS screen policy").

A spec lists structure and vocabulary only: which parts, their labels and their order. It never holds the
console's descriptions or help text; a screen's descriptions, help and states are EmuForge's own words, written in
its requirement. A part of the console screen that the emulator does not have is left out and recorded under
`omitted` (below), with the emulator's answer that shows it lacks the part.

Such a screen is graded `console` and lives in the AWS area, at `/aws` and below (`studio/AGENTS.md`, "Two
layers"). Studio's own layer (the frame, Home, Studio's "Page not found") has no `console` screen and no spec; its
screens are designed per `critique.md` in Studio's own design system.

A spec records the English console: AWS's English labels, from the owner's captures of the English console and the
English AWS user guide. The AWS area is English in every language of Studio (`studio/AGENTS.md`), so a spec has no
other language and a screen's structure score is the same whatever Studio's language.

Inside the AWS area everything is Cloudscape in its default theme, used as published; a spec says nothing about how
a screen looks and does not ask it to look like the console. What a spec pins down is structure: which screen
exists, what it is called, which actions, columns, tabs, fields and steps it has, in which order.

## Where and who

- One file per screen: `studio/references/console/<service>/<screen>.yaml`.
- Written at the Screen stage, reviewed by `rev`, then fixed. A `worker` never edits a spec. A spec changes
  only by the `pm`, with the reason in `decisions.md`.

## Writing a spec

Sources, in this order:

1. The owner's captures of the screen under `docs/aws-console/` (its `.png` and `.mhtml` files), which is not in
   git. They are the first source. They are reference for structure only: of `docs/`, only that folder is read,
   and nothing of the captures (markup, styles, scripts, images, descriptive text) is copied into the repository.
2. The AWS user guide for the service (console procedures, field names and their order), for a screen or an item
   that no capture shows.
3. The corresponding view in StackPort (`DaviReisVieira/stackport`, MIT, a Cloudscape console for local
   emulators). Read StackPort for what a view contains; never copy its code.

Do not write a spec from memory of what the console looks like. An item you cannot point to in one of those
places is not in the spec. The captures are there and are read when the spec is written; they are never committed,
only the spec is.

## Format

```yaml
screen: s3.bucket-list            # <service>.<screen>, unique
service: s3
kind: table                       # table | detail | form | wizard
route: /aws/s3/buckets            # the Studio route that renders it, under the AWS area's /aws

breadcrumbs: [EmuForge, AWS, S3, Buckets]
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
tabs: [General purpose buckets, Directory buckets]

omitted:                          # on the console's screen, not in the emulator
  - item: tabs[Directory buckets]
    reason: "<operation> answers <status> <code> (aws-emulator <version>), so <what the part shows> cannot exist"
```

`route` always starts with `/aws/`: the AWS area's segment followed by the service's route. A screen of one
resource has that resource's id in its route. Where the emulator assigns the id, the spec writes a parameter in its
place, a whole path segment `{<name>}` (a lower-case letter, then lower-case letters, digits or `_`):
`route: /aws/apigateway/apis/{id}`. A route may hold several, each name once. A brace anywhere else in a route is an
invalid spec. An id the caller chooses (a bucket's name) is written out, with the name the seed uses.

`breadcrumbs` are the area's crumbs (`studio/AGENTS.md`, "AWS screen policy", point 8): `EmuForge`, `AWS`, the
service's short name, then the console's crumbs below the service. They never start with "Amazon Web Services" or
with the console's own first crumb.

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

breadcrumbs: [EmuForge, AWS, IAM, Roles, Create role]
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

`omitted` marks a part of the console's screen that the emulator does not have: a tab, a panel (written as a
section), a field, a wizard step, a section or field of a step, or a control of the table (its filter, pagination
or selection). An entry names one item or a block of items, and a block covers every item under it. A marked item
is not scored: it leaves the total and is listed in the report's `omitted` group with its reason.

Some items can never be marked, and `pm-structure` refuses a spec whose `omitted` entry covers one of them, named
or inside a block: the title; an action (`header.actions`, `header.primary_action`, `table.empty.action`); a table
column or the columns' order; a wizard's `submit`; `table.empty.title` beside a `table.empty.action`, which is
found only after it; and an entry of order items alone, since an order leaves the score only with its list (`tabs`
covers `tabs.order`). A screen exists for a resource the emulator has, and every action of a spec acts on that
resource, so an action is not a part the emulator lacks: an action the emulator answers 501 for stays on the
screen and reports that answer.

The mark is set by the spec's author at the Screen stage and reviewed by `rev`; a `worker` never sets it. Its
reason shows that the emulator cannot produce what the part shows, and names each call made, the emulator's answer
and the emulator's version. It is one of:

- an operation the part needs answers 501 or is not served at all;
- the operations answer, but hold nothing the part shows and the emulator offers no way to create it.

A list operation that answers 200 with an empty list is not evidence by itself: most of the emulator's list
operations answer that way, and whether the part can exist takes more calls than a list. A billing,
cross-account or Region part is marked on the same evidence as any other. The example's reason is the form, to be
filled with the calls actually made. "Not built yet" is not a reason; that is a failing item.

## Structure score

Computed from the running app, not from the code, by `.pm/bin/pm-structure`.

1. Open the spec's `route` in the built app at 1280x800 against a seeded emulator, and take the accessibility
   tree (roles and accessible names) of the AWS area: everything under the area's root, its `AppLayout` with the
   breadcrumbs included. A route parameter is filled by the run: `pm-structure … --param <name>=<value>`, once per
   parameter, with the id the emulator answered when the seed created the resource. The screen's requirement says
   which resource the seed creates for each parameter. The value is taken from the answer of that create call,
   never looked up by name, since a name does not identify a resource. It is put into the route percent-encoded, as
   one segment. A parameter without a value, or a value for a parameter the route does not have, is an error
   (exit 2), never a score. The report's second line names the route that was opened. The area's root is the element
   with class `aws-area` (Studio's `AREA_ROOT_CLASS`), and the tree scored is that element's subtree of the
   accessibility tree. Studio's frame around the area is not part of the screen and is not scored, so its language
   does not count either. A page with no element of class `aws-area`, more than one, or one that is not in the
   accessibility tree is an error, not a score: the screen must have exactly one. A spec with items that exist in
   only one data state (`table.empty`, which needs an empty table, or a `single` or `multi` `table.selection`, which
   needs rows) is scored in two runs of the same build: one against a seeded emulator and one against an empty one.
   For a spec whose route holds a parameter, the emulator of the `empty` run is not empty: it holds the resource
   behind each parameter and nothing under it, and the run is given that resource's id as the seeded run is.
2. Every leaf of the spec is one **item**: a breadcrumb, the title, each action, each column, each tab, each
   field label, each step. Each ordered list adds one more item for its order.
3. An item **matches** when an element with the expected role and the same accessible name (trimmed, case
   insensitive) is present; an order item matches when the matched elements appear in the spec's order.
4. Items under `omitted` are removed from the total, and so are the items that do not apply to the run's state
   (`table.empty` in the seeded run, a `single` or `multi` `table.selection` in the empty run). An omitted item
   is still looked for with the rule that would match it, in the states it applies to, passing over an element
   that an item that is not omitted also claims; an omitted item the screen shows fails the run, whatever the
   score, and is reported as `shown` with the element found. An order is never shown, and an omitted wizard step
   is shown by its entry in the step navigation or a heading with its title.

```
structure score = matched items / (all items - omitted items - not-applicable items) x 100
```

- With two runs, each run has its own score, and the screen passes only when both runs pass.
- Every run's first line says how many of the spec's items were omitted in it, as `omitted=<o>/<n>` beside the
  score; no number of omitted items fails a run by itself.

- The report lists every unmatched item, and separately every action, column, tab or field found on the screen
  that the spec does not have.
- The same build, seed and spec always give the same score. Two seeds are the same when they hold the same
  resources; the ids the emulator assigned may differ, and the score does not depend on them.

A wizard is opened once per shown step (its steps that are not omitted, in order): step `k` is the spec's route
opened with `?step=<k>`, each a fresh page, nothing on it operated (no click, no typing). A Studio wizard screen
therefore opens at step `k` when its route is opened with `?step=<k>`; one that ignores the parameter shows its
first step on every page and its later steps come out unmatched. Each step's items are scored on that step's tree
only: its title (a heading, critical), its sections and fields; `submit` (a button, critical) on the last shown
step's tree; the breadcrumbs and the steps' order (each step's entry in the step navigation) on step 1's tree.
Every unmatched, matched and extra line of the report starts with `step <k>: `, the step its item
was scored on or its extra was first found on.

Pass line and what happens below it: `references/critique.md`.

## What a spec does not cover

Color, spacing and typography (Cloudscape tokens decide those inside the AWS area), responsive behavior, and the
content of data. A structure score says the screen has the same parts as the reference. It does not say the
screen is good; the impeccable critique does that.
