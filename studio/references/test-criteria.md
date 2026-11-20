# Studio test criteria

The scenarios that show a studio issue works, written by the plan from the requirement and the design, before any
code. Read this at the `Test Criteria` stage of `references/workflow.md`. Every line becomes an automated test, or is
left out with its reason; nobody walks this list by hand.

## Two kinds of scenario

- **Integration** (Playwright, in `/tests/integration/studio`, written by the plan after the build): a business
  scenario of one task, through the built app, against the real engine and a real emulator.
- **Unit** (Vitest, in `studio/`, written by the unit's worker): logic and single components, such as mapping an SDK
  result, formatting, validation, building a query key, a component in each of its states. Grouped per unit: they
  are the end condition its brief carries.

Put a scenario at the lowest level that can prove it.

## Form

```
### Integration — <check id>            one Playwright check; the id is studio.<slug>
- Given <what the emulator holds, and where it came from>
  - [ ] <the developer does the task> → <what the screen shows> and <what the emulator holds afterwards>

### Unit <unit> — <path under src>       one test file of that unit
- [ ] <input or action> → <observable result>
```

- A business scenario is a developer doing a task: "a bucket made with the AWS CLI is listed, and an object put into
  it from Studio is in the emulator", not "the table renders rows".
- Write what is visible on screen or what the emulator reports. No function names, no state names, no HTTP status
  codes; the one exception is the "not implemented" state, which the user does see.
- A scenario that creates, changes or deletes something ends by asking the emulator directly, not only by reading
  the screen back.
- Pair a task's success with the failure the emulator can give it.
- A scenario reads Studio's English text and runs with an English browser unless it is about a language; one that is
  sets the language as a user's browser does and reads that language's text from its catalogue.
- For a `bug`, append `(regression)` to the scenario that reproduces the reported defect.

Good: `- [ ] Create a bucket with a name the emulator refuses → the form says why and no bucket exists in the emulator`
Bad: `- [ ] validateBucketName rejects an empty string` — implementation, not observable.
Bad: `- [ ] Bucket creation works` — not a checkable condition.

## What to consider

For each task the issue builds, account for these; each is a scenario or a line saying why it is not one:

- the task done end to end, from the state a developer would have;
- data made outside Studio (the AWS CLI, an IaC tool) shown, and what Studio did seen from outside;
- the failure the emulator can give: a name it refuses, a resource that is gone, an operation it answers 501;
- the emulator restarted while a page is open: Studio reconnects and shows the empty account, not stale data. This
  and every other environment case (the emulator or the engine stopped, restarted, not there, not reachable, or
  late) is written for the tier `full` and never for the push run or a whole check (`tests/integration/AGENTS.md`,
  Full tier);
- a screen that reads again after a change (a delete, a create or a save that starts reads of the page or its
  lists): a unit case in which those reads answer in another order than the one the mock gives by default, for
  whatever the change shows afterwards (a result, a hand-over to another page). Mocked reads answer in one order,
  and the order of the real ones is the machine's: a result shown from a dialog the page unmounts when one read
  answers "not found" first is lost (issue 551, IAM).

Good: `- [ ] Delete a policy and the read of the policy answers before the read of its document → the policy list says "Policy {name} deleted."`

A unit test finds what is inside a Cloudscape component (an option, a table's rows and cells, a header's heading
text and counter, a flash, a modal, a form field's error) with Cloudscape's test utils,
`@cloudscape-design/components/test-utils/dom`, and chooses an option by its value, as an integration check does
(`/tests/integration/AGENTS.md`, Studio checks: what they find and when they assert).

Keyboard and safety are not scenarios of a screen. They are checked once, for the app and for the area, by checks of
no service (keyboard reaches every action of the frame and the area's frame; no request leaves for anything but the
engine and Studio's own origin; nothing but the language choice is stored); a service issue adds none of its own.
How a screen looks at a width, in a theme or in a language is the critique's (`critique.md`), not a scenario.

## Left out

The plan may leave an integration scenario out when the issue is too slight or the test would cost more than it
shows. It says so here, with the reason, when it can tell before the build, and in its `report.md` at the end. When
it cannot tell, it asks the `pm` (`lead.md`).

## Scope

- Derive scenarios only from the confirmed requirement and design. A scenario that cannot be decided from them is a
  question for the `pm`, not a rule to invent.
- An operation the emulator answers with 501 is asserted as the "not implemented" state, never as working.
- No performance number unless the requirement set one.
- A test does not assert how many entries a list has when the list grows with the product (services, screens,
  catalogue messages); it asserts the property the number stood in for (each entry well formed, two lists equal, no
  entry twice by its key, the list not empty). A number that is the behaviour under test stays (a page of 25 items,
  the 50-tag limit).
