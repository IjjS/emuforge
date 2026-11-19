Issue-Id: 483
Issue-Severity: HIGH
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|product|brd-into-the-guides
Issue-Check-Ids: harness.product-docs
Issue-Commit: aa4c03efad86f9b110d88c61c26e552f651ddd90

# Put the owner's product plan of 2026-11-18 into the repository as its product guide, and bring the guides that differ to it

> Identified against commit `aa4c03efad86f9b110d88c61c26e552f651ddd90`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's product plan of 2026-11-18 (BRD), kept verbatim in Korean at `.pm/product/brd-2026-11-18.md` in the main checkout (untracked; issue 483 brings it into the repository). The repository has no product guide that says what EmuForge is and in what order it is built: root
`AGENTS.md` describes the modules, `studio/PRODUCT.md` Studio's product, `README.md` the Compose form of issue 437.
Some of what they say differs from the plan: the image (three processes today: `emuforge-server`, Bun serving Studio,
HAProxy), the Compose form (the emulator in the engine's network namespace), the emulator reached only at
`127.0.0.1`, "using an emulator already running is for later".

Wanted: a root `PRODUCT.md`, in English, that holds the plan (overview and directions, the parts and ports, the
roadmap 1 Studio, 2 CLI, 3 IAM, 4 IaC, the first phase's features, the CLI's commands as planned, the two ways of
delivery and their comparison, release and versions, the non-functional requirements, what is out of scope), said
as the owner's plan with the owner's Korean words quoted where a sentence decides something; root `AGENTS.md`
names it once; `studio/PRODUCT.md` and `README.md` are brought to it where they differ, or say that issues 484 to
486 will change what they describe (no product behaviour changes in this issue).

## Evidence

The plan's file above.

## Steps to Reproduce

Read root `AGENTS.md`, `README.md` and `studio/PRODUCT.md` against the plan.

## Expected

One product guide in the repository that every agent can be pointed to; no guide that contradicts it without naming the issue that will change it.

## Out of scope
