# Studio test criteria

Conditions that show a feature works and is finished, stated as what is visible on screen and what the
emulator holds afterwards. Written before implementation. Read this at the `Test Criteria` stage of
`references/workflow.md`.

Nobody walks this list by hand. Every line becomes an automated test, so every line must be something a test
can observe.

## Two kinds of case

- **Unit** (Vitest, in `studio/`): pure logic and single components. Mapping an SDK result, formatting,
  validation, building a query key, a component rendering each of its states.
- **Flow** (Playwright, in `/tests/integration/studio`): a user path through the built app against the real
  engine and a real emulator.

Put a case at the lowest level that can prove it.

## Form

Group cases under one heading per target.

- `### Unit — <path under src>` maps to one test file.
- `### Flow — <check id>` maps to one Playwright check. The id is `studio.<slug>`, for example
  `studio.s3-create-bucket-appears-in-list`.

```
- [ ] <action> → <observable result>
```

- Write what is visible on screen or what the emulator reports. No function names, no state names, no HTTP
  status codes; the one exception is the "not implemented" state, which the user does see.
- Pair a success condition with its failure condition wherever an action can fail.
- A flow that creates, changes or deletes something ends by asking the emulator directly, not only by reading
  the screen back.
- Append the scope only when a condition does not hold everywhere: `— 390 wide`, `— dark`.
- For a `bug`, append `(regression)` to the case that reproduces the reported defect.

Good: `- [ ] Create a bucket with an empty name → the field shows its constraint text and no bucket exists in the emulator`
Bad: `- [ ] validateBucketName rejects an empty string` — implementation, not observable.
Bad: `- [ ] Bucket creation works` — not a checkable condition.

## Coverage

Nine axes. Each is accounted for in the checklist below whether or not it produces a case.

1. **Happy path**: every goal in the requirement reached end to end.
2. **Input validation**: empty, whitespace only, over the maximum, duplicate, characters the service forbids;
   the message is the one the reference shows.
3. **States**: loading, empty, error, not implemented by the emulator (501), access denied, engine
   unreachable, emulator unreachable, retry after failure.
4. **Boundaries**: a list with zero, one and many items; more than one page; very long names; missing values.
5. **Navigation**: back, a deep link straight into the screen, refresh, a link to a resource that no longer
   exists.
6. **Repetition**: double click on submit, repeated submit, leaving a form or wizard midway and returning.
7. **Data propagation, both ways**: what Studio creates, changes or deletes is so in the emulator; what was
   created outside Studio (AWS CLI, an IaC tool) appears in Studio; every screen showing the same resource
   reflects the change.
8. **Emulator lifecycle**: the emulator restarts and Studio reconnects without a reload, showing the now empty
   account rather than stale data.
9. **Finish**: keyboard reaches every action, focus returns after a dialog, light and dark, 1280 and 390 wide
   without horizontal overflow.

## Coverage checklist

The test criteria always end with this fixed block. Check an axis once its cases are written; append
`(Not Scope)` to one the issue does not touch.

```
### Coverage
- [ ] Happy path
- [ ] Input validation
- [ ] States
- [ ] Boundaries
- [ ] Navigation
- [ ] Repetition
- [ ] Data propagation
- [ ] Emulator lifecycle
- [ ] Finish
```

## Lightweight path

`bug` and `gap` issues do not walk all nine axes. Required:

- the reported steps no longer reproduce it
- the intended behavior completes end to end (axis 1)
- the neighbouring actions on the same screen still work

Then add only the axis the cause sits in; the rest are `(Not Scope)`.

## Scope

- Derive conditions only from the confirmed requirement and the screen's reference spec or design. A condition
  that cannot be decided from them is a question for the `pm`, not a rule to invent.
- An operation the emulator answers with 501 is asserted as the "not implemented" state, never as working.
- Do not restate one condition per viewport or theme; use the scope suffix.
- No performance number unless the requirement set one.
