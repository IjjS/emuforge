# The AWS area

Read this when a unit's files are under `providers/aws/area/` (`/aws` and below): the area's frame, its own pages
and every AWS service's screens. What is forbidden everywhere in Studio, and the area's import boundaries, are in
`studio/AGENTS.md`; what keeps the area's styles and Studio's apart is in `own-layer.md`, "No leak either way".

## AWS screen policy

The owner's decisions of 2026-11-16 (issue #45), as the owner changed them on 2026-11-18 (issue 478): "ui나 규격,
구조는 실제와 같으면 안되고 약간 다른 기능이 들어가거나 해도 좋아" (the UI, its specification and its structure need
not be the real console's, and a screen may well do something a little different). This section is the policy's
home; `PRODUCT.md`, `workflow.md` and `critique.md` point here. It applies to every page of the area, the area's own
pages included.

1. **A screen serves a task.** A service's screens are built from the tasks a developer does with the service
   locally, as far as the emulator's API supports them (`workflow.md`). A screen need not match the AWS console's
   structure, flow or labels, and may do what the console does not. Nothing in Studio's guides asks an AWS screen to
   look like, mirror or copy the AWS console.
2. **The console is a reference for UX.** The owner's captures of the real console under `docs/aws-console/` are
   read for how a flow that calls the API goes (what is asked, in what order, what a developer expects to find),
   never as a specification. The service's terms (a bucket, a function, a role, an ARN) are the service's own, as the
   API names them; a label follows the console where that helps a developer recognise it.
3. **EmuForge's own words.** Descriptions, help, guidance, and the empty, loading and error states are EmuForge's
   own words, never the console's. They say only what the engine knows: an endpoint comes from the engine's
   connection status, never from a constant, and a claim about the emulator's behavior needs a check that shows it.
4. **Only what the emulator has.** A part (a panel, a tab, a navigation entry, a badge) is on a screen only if the
   emulator really has it, shown by calling the emulator at the Requirement stage.
5. **An operation the emulator lacks is said so.** When the emulator answers an action of a task with HTTP 501, the
   screen reports it as "not implemented by the emulator" (`studio/AGENTS.md`, "Errors and states"); the action is
   not hidden and not faked.
6. **Cloudscape as published.** Cloudscape and its default theme are used as published, in its published patterns;
   a screen is not made to look like the console. EmuForge's own states use Cloudscape's patterns as well: a
   `Flashbar` for an action's result, an error status with a retry for a failed load.
7. **The emulator line and the notice.** Every page of the area carries the emulator line, which cannot be
   dismissed; a screen that shows resources of the emulator also carries the local-emulator notice, worded for its
   resources, closable, with the (i) control that brings it back. Both are described below.
8. **Breadcrumbs start at EmuForge.** `EmuForge > AWS > <service> > …`, for example `EmuForge > AWS > S3 >
   Buckets`. "EmuForge" leads to Home (`/`), "AWS" to the area's index (`/aws`), a service's crumb to the
   service's route; the last crumb is the current page and is not a link. A service's crumb is its short name: its
   label without a leading "Amazon " or "AWS ", the acronym where the service's route abbreviates the name (`S3`,
   `EC2`, `IAM`), "Systems Manager" for `ssm`. No crumb reads "Amazon Web Services".
9. **Shared parts are lifted when a second service needs them.** A part one service needs stays in its folder; when
   a second service needs the same part it moves to `providers/aws/area/components/` (or `lib/`), not before.
10. **Studio's own layer is its own.** Studio's own layer keeps its own design tokens and components, shaped by the
    critique (`own-layer.md`).

The UI and UX of a screen are its worker's to shape, inside these points; the impeccable critique judges them, once,
on the built app (`critique.md`).

## A service's entries

The requirement of a service issue gives its entries using these rules. Use the API models the local emulator
answers at the service's entry, in the order of the service's `models` in `.pm/bin/probe-services.json`. Use the
emulator's answers and the API models, independently of the AWS console's navigation.

1. Each model with entries is a group. The first model is the service itself. Each later model is a sub-service
   with its own name and path, `/aws/<service>/<sub-service-name-in-kebab-case>`, in its group's navigation.
   Show group names when there is more than one group.
2. A resource kind has a list read whose output model contains a list and a making operation in the same model.
   An account list is a `Describe*` or `List*` read from the probe table that answers 2xx without an argument of its
   own. A scoped list is a `List*` or plural `Describe*` outside the table with one required member naming a parent
   kind of the same model, or a read from the table refused without its parent and with a member that identifies
   that parent. Probe scoped reads with an existing parent and require a 2xx answer. A 501 gives no entry. Reads of
   one item at a time and reads requiring more than one argument are reached from their parent's screens. When
   both `List` and `Describe` give the same kind, use `List`.
3. Pair the list read with an operation that makes the kind. Start with the singular or plural noun after a
   making verb such as `Create`, `Register` or `Put`, and use the API's semantics when names differ. Record the
   list read, the maker, any parent and the emulator's answer for each entry, and explain why other candidate
   reads give no entry. Catalogues, account settings and limits, tags or state of a single item, and activity
   without its own making operation give no entry. See issue 650 for the first application of this rule.
4. A kind from a model shared by services belongs to one service. From the `ec2` model, VPC gets nouns containing
   `Vpc`, `Subnet`, `Route`, `Gateway`, `NetworkAcl`, `NetworkInsights`, `NetworkPerformance`,
   `SecondaryNetwork`, `Ipam`, `Vpn`, `DhcpOptions`, `FlowLog`, `PrefixList`, `TrafficMirror`,
   `VerifiedAccess`, `Pool` or `Cidr`. EC2 gets the other kinds.
5. Keep existing navigation labels and addresses and the existing links, tabs and buttons between resource
   screens. When a built list has only the service's route, register a second path for its entry
   (`/aws/kms/keys`, `/aws/ssm/parameters`) and continue to open the list at the service's route.
6. Label a new kind with the read's noun in words, capitalising the first word and retaining API acronyms. Its
   path is `/aws/<service>/<noun-in-kebab-case>`, including for kinds listed inside a parent. For a path shared
   by two groups, prefix the later model's kind with that model's words. Labels and paths are unique within a
   service. The service's route belongs to its navigation header.
7. Inside a group, show entries with screens first, in the order written, followed by other entries by label. A
   screen is available when a registered screen matches the entry's path. Adding that screen needs no entry edit.
8. For a scoped kind record the parent entry's path as `listedInside`. If Studio already lists a kind inside
   another entry's screen, record `shownIn` with that entry's path and the place in words, even for a kind listed
   for the account. Write this when the view is built.
9. Write `ENTRIES` in the service's own `entries.ts` as plain data using the area's `EntryGroup` type. The area
   collects these files at build time. Each group gives its name when needed, its optional `subService` (name and
   path), and its `entries` (label, path, `listedBy`, and any `listedInside` and `shownIn`). The file requires a
   `screens.ts` and takes the place of the screen's hand-written navigation items. A folder without an
   `entries.ts` keeps its existing navigation, including a service with no screens.

On every screen and area page of the service, the side navigation carries a link for each entry, with
"No screen yet" in text beside the ones without a screen. Show each sub-service's link alongside its kinds in
its group. Group headings are controls or text. Mark at most one link current, including the header. A screen
uses its `activeHref`, an entry page uses its path, and a generic page uses the screen above the path when
there is one. Open the group containing the current entry.

A registered screen takes precedence. At an exact entry path without a screen, the area's entry page calls
nothing and shows the emulator line, with no notice, (i) control or help toggle. Its title, `h1` and final crumb
are the entry's label or sub-service name. It says "Opening this page changed nothing in your local emulator."
and offers "Go to Home". A path below an entry still follows the generic page rules.

- A kind shows "Resource kind", "Part of" for a named group in a multi-group service, "Listed by" with the API
  operation as code, and "Listed inside" with the parent label when scoped.
- With `shownIn` it says "Studio has no screen that lists these across {service's crumb} yet." and
  "It shows them in {place}." The primary action leads to the entry named by `shownIn`.
- Otherwise it says "Studio has no screen for this yet." The primary action leads to the parent for a scoped
  kind, or the service's first screen at a literal path when one exists.
- A sub-service uses the same general statement, shows "Sub-service" and "Part of" with the service's crumb,
  lists links under "Resource kinds" with the same status text as the navigation, and offers the first screen
  when one exists.

## The emulator line

- Every page of the area shows one line, the emulator line, between the breadcrumbs and the page's content, at
  every width and in every state of the page. It has no control that closes or hides it, and it is not inside the
  side navigation or anything else that can be collapsed.
- It is the constant label "Local emulator, not AWS" followed by the connection's state, as the engine reports it
  in the connection Studio hands the area ("The area in Studio's frame"), and from nothing else:

| State | Status after the label | Cloudscape status type |
|---|---|---|
| No check has answered yet | "Checking" | loading |
| The emulator is connected | "Connected at `{endpoint}`" | success |
| The emulator is not started | "Not started on port `{port}`" | stopped |
| The emulator does not answer, for any other reason | "Not answering at `{endpoint}`" | error |
| The engine does not answer | "The EmuForge engine at `{engine origin}` is not answering" | error |
| The engine answers with an error that has a code | "The EmuForge engine answered with an error: `{code}`" | error |
| The engine answers with an error without a code | "The EmuForge engine answered with HTTP status `{status}`" | error |

- `{endpoint}` and `{port}` are the emulator's as the engine reported them in that answer, `{engine origin}` the
  engine's address the page is configured with. Every value is rendered as text; no endpoint, port or origin is a
  constant in the area's source, and a state in which the engine does not answer or answers with an error names
  no emulator endpoint.
- In the states that come from the emulator's answer (connected, not started, not answering), when that answer names
  the engine's target, the status is followed by a part of its own, "Target `{target}`", the name as the answer gave
  it, rendered as text in code style, the whole part a Cloudscape `Box` so it takes Cloudscape's font (issue 486, R2). The status texts above are unchanged, word for word and in the
  same element. The engine states and "Checking" name no target, and an answer that names none shows no part.
- In every state but "Checking" and connected the line ends with the link "Connection status" to Home, a route
  change like a crumb's.
- The line stays current while a page of the area is open (the 5-second rhythm of "The area in Studio's frame");
  while a later check is in flight it keeps showing the last answer's state. A change of state is announced once, label and new
  status together, with the target part as a sentence of its own when there is one ("… on port `{port}`. Target
  `{target}`"), in a polite live region that does not hold the link; a
  check that finds the same state announces nothing, and the first answer is announced only when it is not
  connected. A change of target that keeps the kind of status (connected to connected, say, even with another
  endpoint) is announced by the area's flash on a screen's page ("The area in Studio's frame"), so there the line's
  live region says nothing of it; on the area's own pages (its index, "no screen yet", "Page not found"), which show
  no flash, the line's live region announces it, label and whole line, once. A change of the kind of status is
  announced as before, whatever the target.
- The line's height is not fixed: at 390 wide a long status may take a row more, so a check that compares
  positions on a page of the area measures after the line shows its first answer.

## The local-emulator notice

- A screen of the area that shows resources of the emulator carries a notice directly under the emulator line,
  worded for its resources: "These {resources} are in your local emulator", with the plural word the screen gives
  ("These buckets are in your local emulator"), or "These resources are in your local emulator" when it gives
  none. A screen turns the notice on by naming its resources to the area's frame.
- Its body is the same in every state of the connection: "They are not in an AWS account. EmuForge Studio is a
  stand-alone local tool, not an AWS feature." The endpoint is written once on a page, in the emulator line.
- It is an informational Cloudscape notice with a close control (X) named "Close the local emulator notice".
  Closing it removes it from every page of the area until the document is reloaded; nothing is stored.
- On a page that carries the notice the emulator line ends with an (i) control, a button named "About the local
  emulator" that says whether the notice is open (`aria-expanded`). Activating it opens a closed notice and moves
  focus to it, or closes an open one; closing the notice with its X moves focus to the (i) control. The (i)
  control is never removed.
- The area's own pages (index, "no screen yet", "Page not found") show no resources: they carry the emulator line
  and neither the notice nor the (i) control.

## Where the line and the notice sit

- Both are inside the area's content target, before the page's `h1`: the content target holds the line, the
  notice when the page carries it, then the `h1` and the page's controls, and is still named by the `h1`. "Skip to
  content" and every route change therefore put focus where the next thing read is "Local emulator, not AWS". A
  result of an action (the area's `Flashbar`) sits after the notice and before the `h1`.
- Tab order: the breadcrumbs, then the line's controls ("Connection status" when shown, then the (i) control when
  the page has it), then the notice's close control when it is open, then a flash's "Dismiss" when one is shown,
  then the page's content. While connected on a page without the notice the line adds no Tab stop.
- They are Cloudscape components styled with Cloudscape tokens only, inside the area's root, under every rule of
  "Inside the area: Cloudscape" below. At 1280 and 390 wide, light and dark, the line wraps inside the page (a long
  endpoint breaks rather than overflowing) and stays visible at 390 with the side navigation closed.

## Inside the area: Cloudscape

Applies to everything under `providers/aws/area/`, at `/aws` and below.

- Use Cloudscape components and patterns as they are: `AppLayout`, `SideNavigation`, `BreadcrumbGroup`,
  `Header` with actions, `Table` with `collection-hooks`, `PropertyFilter` or `TextFilter`, `Pagination`,
  `Form` with `Container` and `FormField`, `Wizard`, `Modal`, `Flashbar`, in Cloudscape's published patterns
  ("AWS screen policy", point 6).
- Style with Cloudscape design tokens only. No hardcoded color, spacing or font. No CSS that restyles a
  Cloudscape component's internals. No rule of the area names a `--st-*` property.
- Light and dark through Cloudscape's mode, applied to the area's root element only: in dark that element
  carries `awsui-dark-mode`. `html` and `body` never carry an `awsui-` class. Both modes are checked.
- The token declarations Cloudscape's base theme makes on `body` are made on the area's root as well, so an alias
  token (one defined as another token, such as the side navigation's panel background) resolves at the area's
  root and takes the dark value there in dark.
- Cloudscape's base applies inside the area: the rules of `@cloudscape-design/global-styles/index-base.css`
  (normalize and its `html` and `body` rules) are scoped to the area, their `html` and `body` rules to the area's
  root, and match nothing outside it. `@cloudscape-design/global-styles/index.css` is never applied to the
  document as a whole. Cloudscape's fonts (`global-styles/fonts.css`, `@font-face` only) are served from the
  app's own origin.
- Overlays stay in the area: no component uses `expandToViewport`, and a `Modal` renders into the area's root
  (`getModalRoot`), so no Cloudscape element is rendered outside the area. `bun run lint` fails on a use of
  `expandToViewport` under `providers/aws/area/`, and on a file under `providers/aws/area/services/` (tests
  included) that imports Cloudscape's `Modal` or names a modal root of its own (`getModalRoot`, `removeModalRoot`,
  `modalRoot`): a service's dialog is the area's `AreaModal`, and a `CollectionPreferences` takes the area's root
  from `useAreaModalRoot()` (`components/area-modal.tsx`).
- A destructive action is confirmed, in a `Modal` or on a confirmation page of its own; one that cannot be undone
  and removes data asks the user to type the resource's name or a word.
- The result of an action is announced in the `Flashbar`. A save in progress disables its button and keeps
  focus where it was.
- Fill every `ariaLabel` and `i18nStrings` a component asks for. A dialog traps focus, closes on Esc, and
  returns focus to what opened it.
- UI text is English, in every language of Studio: EmuForge's own words, written in the requirement or the design,
  never taken from the console ("AWS screen policy", point 3), and the service's terms (point 2), the emulator line
  and the notice included. The area imports nothing from `i18n/`; its root carries `lang="en"`; and everything it
  renders sits inside Cloudscape's `I18nProvider` with locale `en` and Cloudscape's English messages
  (`i18n/messages/all.en`). Cloudscape otherwise takes its locale from `<html lang>`
  and the browser's language, so a date, a number or a component's built-in text would follow Studio's language.
- A change of Studio's language does not re-render the area from scratch: its text, focus and state stay as they
  were. On a page of the area the frame is in Studio's language and the area in English, each marked by its `lang`.

## The area in Studio's frame

- The area sits in Studio's frame, below the top bar, and fills the rest of the page. Studio's frame is never built
  from a provider's design system, and a provider's area holds nothing of Studio's own design.
- Each provider has exactly one first segment (`aws`), and every path under it belongs to its area, the area's
  EmuForge-only states included (its index, "no screen yet", its "Page not found"). A service route is the
  provider's segment followed by the service's route: `/aws/s3`, `/aws/s3/buckets`.
- Studio has one list of providers, `app/provider-list.ts`. An entry gives the provider's name ("Amazon Web
  Services"), its short name for the frame ("AWS"), its first path segment (`aws`), its services for Home (label,
  path and whether the service has a Studio screen) and its area: the component that renders everything under its
  segment, loaded with a dynamic `import()`.
- Studio hands an open area its connection as a plain value: the latest answer of the engine's connection status
  (none before the first answer) and the engine's origin. Studio's frame checks the connection as Home does, when
  a page of the area opens and again 5 seconds after each answer, for as long as a page of the area is open, so a
  route change inside the area keeps the last answer. The area reads the connection from what Studio hands it and
  its types from `lib/`, and imports nothing from `app/` or `features/` to learn it.
- Beside the connection Studio hands the area `targetGeneration` (issue 486, R3): how many changes of target the
  document has seen, `0` until the first, absent meaning `0`. The area learns the target only from what Studio hands
  it. When the number changes while the area is mounted, the routed page alone (below the emulator line, the notice
  and the flash) is mounted again in place: it reads its data afresh from the new target (Studio dropped what the
  area had cached) and keeps no local state of the earlier one, a page token, a selection or a half-filled form
  included, with no "Discard what you entered?" asked. The line, the notice and the layout stay mounted with their
  state. No route changed, so no focus is moved for one: focus that was inside the page moves to the content target,
  and focus anywhere else (the line, the notice, the flash, the side navigation, Studio's bar) stays where it is. On a
  screen's page the flash shows the info result "The target is now `{target}`. This page now reads from it.",
  announced once as any flash, as soon as the connection Studio hands names a target other than the
  one before the change; the area's own pages show no flash, and the emulator line announces the change there. An
  area that mounts with the number already above `0` remounts nothing and shows no
  flash, and a route change with the same number is as any route change.
- The frame, Home and the router read that list and name no provider themselves. Adding a provider is one new
  entry and that provider's own folder (`providers/<id>/provider.ts`, `providers/<id>/area/`); it changes no file
  of Studio's own screens and no file of another provider's area.
- A provider's area brings its own design system and its own colour mode handling. Its code and styles load only
  when a path of the area is opened: a fresh load of `/`, or of Studio's "Page not found", requests no script or
  stylesheet of any area.
- No provider is listed or shown before it is built; there is no "coming soon".

## What earlier critiques found

Five things that four critiques of AWS screens repeated, written down on 2026-11-18. They are guidance, not rules: what
the area's shared parts carry and what a worker may start from. A worker may depart from any of them where its task is
better served; the critique judges the screen, not its agreement with this list. The shared parts that carry them
are in `providers/aws/area/components/`: the value element (`value-text.tsx`), the value with its copy control
(`copy-value.tsx`) and the discard dialog (`discard-dialog.tsx`).

1. **The frame says where the resources are; the page's own text does not say it again.** On a page of the area,
   that what it shows is in the local emulator and not in AWS is said in one place, the area's frame, and the
   emulator's endpoint is written in one place, the emulator line. The line is the statement, always there; the
   local-emulator notice is the line's own explanation, opened and closed from the line's (i) control, and it does
   not write the endpoint again: its body is the same in every state of the connection. So with the notice closed a
   page says it once, in the line, and with the notice open the line is followed by its explanation, whose heading
   and body say what the line's four words mean, and the endpoint is written once, in the line. Text of the page
   above its content (the `h1`'s description, a wizard step's description, a section header's description) does not
   say it again: it does not say where the resources are or that they are not in an AWS account, and it names no
   endpoint. A description says what the page is for or what is particular to it (a filter's rule, what a column
   reports, what a form creates besides the resource), in one or two sentences of EmuForge's words, and is left out
   when it would only repeat the title. Below the header, a sentence names the local emulator or its endpoint only
   where it would be unclear without it: the sentence that says what a destructive action removes, the result of an
   action, and an empty, not-found or failure state. The help panel, opened on demand, is not such text.
   Reason: the line cannot be closed and is the first thing read after the crumbs, so the same statement said again
   by each page becomes boilerplate that hides it, and at 390 wide pushes the page's content down.
2. **A field's rule is shown before the first submit.** A single text field of a form, a wizard or a dialog whose
   value is checked against a length, an alphabet or a number range shows that rule under it from the start, as
   Cloudscape constraint text, in EmuForge's words: the length first, then the characters, then what a name must
   begin or end with. It states what the form itself lets through, and each of its limits is one the emulator's
   answer at the Requirement stage was seen to enforce, or a narrower one the form already keeps. The message a
   field shows after a failed check stays and still names the rule that failed; the constraint text stays beside it.
   A field checked only for being filled, a field of a row that repeats (a tag editor's key and value) and a
   confirmation field (a name or a word typed to confirm) carry no constraint text.
   Reason: a rule learned by failing costs a round trip, and the names of the services have unlike rules (a bucket's
   lower case, a function's `_`, a role's `+=,.@`).
3. **A value taken elsewhere has a copy control.** On a page of one resource, a value that names a resource to
   another tool (an ARN, a URL, an id the emulator assigned) is shown with Cloudscape's `CopyToClipboard`, variant
   `inline`: an icon button directly before the value's text. The button is named "Copy {label}" with the field's
   label; a press puts the value, exactly as the emulator gave it, on the clipboard and shows "{label} copied", or
   "{label} could not be copied" when the browser refuses. A value that is absent ("-"), a status or a failed read
   has no control. The value's text follows entry 4; the popover stays inside the area (no portal). In a table,
   values are not given a control each: where the screen has an action for it (such as the S3 bucket list's "Copy
   ARN"), that action is the way.
   Reason: an ARN or a URL is read here to be used in a terminal or an IaC file, and selecting by hand a value that
   wraps over five lines at 390 wide is the slow path.
4. **How a long value breaks.** At 1280 and 390 wide no page scrolls sideways, no value is cut or clipped, and a
   table may scroll inside itself. Within that, a value is never broken inside while it fits the line it is on. What
   happens when it does not depends on what it is:

   | Kind | Values | Breaks |
   |---|---|---|
   | An address | an ARN, a URL, a path | only directly after `:` or `/` (a URL also after `?` and `&`), so each line but the last ends with one of them, while every part between two of them fits a line; a part longer than a line breaks anywhere |
   | A name | a resource's name, a key, an id | whole on one line where the line is wide enough for it; longer than its line, anywhere. In a table a name's column keeps room for 24 characters, so a name of up to 24 is on one line at 1280 and 390 |
   | A fixed word | a status, an enumerated value ("Enabled", "Zip"), a Region, a date, a number | never inside a word; in a table its column is as wide as its longest word |
   | Free text | a description, a reason, a message, a tag's value | at spaces; a word longer than its line breaks anywhere |

   Nothing is added to a value to make it break: its text is the emulator's value character for character, and
   selecting it copies exactly that. The one way of breaking is the area's (`providers/aws/area/components/`), used
   by every service, and a page states for each value which of the four kinds it is; a service keeps no breaking
   rule of its own. A table's name column follows it too: a name longer than its cell breaks inside the cell instead
   of widening its column. Preformatted text (a trust policy's lines, kept as sent) keeps its own rule.
   Reason: `overflow-wrap: anywhere` on every value (2026-11-17) stopped pages scrolling sideways by letting any
   column shrink to one character, so short values broke mid-word and an ARN broke inside its name, while an ARN is
   read part by part and a name is compared whole.
5. **"Cancel" asks before it discards what was entered.** On a create form or wizard, "Cancel" leaves at once while
   nothing differs from what the form showed when it opened (what its address preselected included). Once any
   field, choice or row differs, on any step, "Cancel" opens a Cloudscape `Modal` (the area's `AreaModal`) and
   nothing else happens until it is answered:
   - header "Discard what you entered?"; body "What you entered on this page is not kept.";
   - "Keep editing" (link) closes it, the form as it was, focus on "Cancel"; so do Esc and the close control, named
     "Close";
   - "Discard" (primary) leaves as "Cancel" did before, to the same page, and nothing is created.

   A value typed and removed again does not differ. A form that holds only a confirmation field and a dialog's own
   "Cancel" are not asked about. Leaving another way (a crumb, the side navigation, the browser's back, a reload) is
   not asked about.
   Reason: "Cancel" sits beside the submit button and is one press, and a wizard holds steps of work, a create form
   many sections.
