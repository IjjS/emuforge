# Product

<!-- impeccable:product-schema 1 -->

Sources: the owner's product plan of 2026-11-18 (the root `PRODUCT.md`, which holds the roadmap, the parts and
their ports, and the two deliveries), the owner's answers of 2026-11-15 (issue #16), the owner's two-layer decision
of the same day, the owner's decisions of 2026-11-16 on AWS screens (issue #45), the earlier BRD's one-line
definition, principles and MVP scope, and the safety rules of the root `AGENTS.md`. Anything those do not confirm is
listed as undecided below.

## Platform

web

## Users

Three primary audiences, all confirmed by the owner:

- **Application developers** whose code calls AWS. They check that code against the local emulator before they
  deploy.
- **IaC and infrastructure engineers.** They verify resources and IAM policies locally before they touch real AWS.
- **People learning AWS.** They practise without an AWS account and without cost.

Team use and CI use were offered and not chosen; they are not a primary audience.

The jobs a user does in Studio: see whether Studio reaches the engine and the emulator, and fix it when it does not;
go into a cloud provider's area and work there in the structure and flow of that provider's console, in screens that
are not a copy of it and that say on every page that this is a local emulator, not the provider.

## Product Purpose

EmuForge is a local workbench on top of AWS's official `aws-emulator`. It does not reimplement the emulator; it adds
a web console (EmuForge Studio), a CLI, IAM policy evaluation and IaC verification on top of it.

EmuForge is a multi-cloud local workbench. AWS is the first provider. Google Cloud and Azure are the planned
direction, not merely a possibility left open (the owner's decision of 2026-11-15; the plan of 2026-11-18 supports
AWS's emulator alone at first, designed to extend to other providers).

Studio is phase 1 of the owner's plan (root `PRODUCT.md`, "Roadmap"); the CLI, the IAM simulator and IaC
verification follow it.

MVP success, as the earlier BRD states it:

- Studio and the engine start with Docker Compose and are reached in a browser.
- The main create, read, update and delete operations of S3 and DynamoDB are verified by integration checks.
- Studio reconnects after the emulator restarts.
- A connection failure, a certificate error and an API the emulator does not implement are shown as different
  things.
- No request goes to a real AWS endpoint.

## Positioning

EmuForge stands on the official emulator rather than beside it: the emulator is called, never changed or
reimplemented, so what Studio shows is what the emulator really holds and really answers. It shows resources
created anywhere (Studio, the CLI, Terraform) and states plainly what the emulator does not support instead of
hiding or faking it. Everything runs locally; nothing reaches real AWS.

EmuForge is an independent project. It is not affiliated with, endorsed by or sponsored by Amazon Web Services (AWS).

## Operating Context

- Runs on the user's own machine. The emulator runs separately; Studio talks only to the engine, never to the
  emulator and never to AWS. In the plan the engine reaches the emulator of the chosen target: an endpoint the user
  registers in the native CLI's form, the emulator's Compose service in the Compose form. Today the engine connects
  to one emulator, on a port the user names, on loopback; issues 484 and 485 change that.
- The emulator's keys and certificates change on every emulator start; the engine reads them again, and Studio
  reconnects.
- Users work alongside their own tools: application code, the AWS CLI, Terraform and other IaC, whose resources
  Studio shows as they are.
- Studio has two layers:
  - **Studio's own layer**: the parts only Studio has (its frame, home or dashboard, settings, connection status,
    and later the IAM simulation and Verify results). These are original and do not imitate any provider's console.
  - **The provider layer**: inside Studio's frame, each cloud provider's area follows the information structure and
    flow of that provider's console and is not a copy of it. AWS is the only provider today; its area follows the
    AWS console's structure and flow, built from Cloudscape in its default theme, by the AWS screen policy
    (`studio/AGENTS.md`, "AWS screen policy"). Google Cloud and Azure, when added, follow the structure and flow of
    their own consoles, not AWS's.

## Capabilities and Constraints

Confirmed MVP scope for Studio and the engine (the earlier BRD, and phase 1 of the owner's plan of 2026-11-18):

- Connect to a running emulator on a given port; read the keys and certificates again after a restart.
- Emulator connections (phase 1 of the plan; issues 485 and 486): register, choose, test and remove several
  emulators; switch the target Studio's screens read; show whether it is connected, the error and the endpoint.
- Home: connection status, emulator version, endpoint, recent errors, and the engine process's own CPU and memory
  use (never the host's or other processes').
- AWS service screens that follow the AWS console's structure and flow and are not a copy of it (Cloudscape): list,
  detail, create wizard, edit and delete. Resources made outside Studio appear as well. First targets: S3 and
  DynamoDB. The IAM console is built on the emulator's IAM API the same way as the other service screens.
- An HTTP 501 answer is shown clearly as "not implemented by the emulator".
- Destructive actions are confirmed. Light and dark mode.
- One Docker Compose start brings up Studio and the engine (and the emulator when needed). In the plan they are one
  emuforge binary in one image, on two ports, beside the emulator in its own container (issue 484).

Constraints (BRD principles and the owner's decisions):

- The emulator is not modified; EmuForge only calls an emulator started separately.
- The engine stays light; per-service logic does not accumulate in it.
- No request goes to real AWS, under any circumstance.
- What is and is not supported is never hidden; the emulator's `501 NotImplemented` is shown as it is.
- Start simple; add complexity when a real need appears.
- A provider's area follows the structure and flow of that provider's console and is not a copy of it. The
  provider's design system stays inside that provider's area (Cloudscape inside the AWS area), and Studio's own style
  does not restyle a provider area.

Terminology: **EmuForge** (the product), **EmuForge Studio** or **Studio** (the web console), **engine** (the local
server between Studio and the emulator), **provider** and **provider area** (a cloud provider and its part of
Studio).

Undecided:

- The order of AWS services after S3 and DynamoDB (SQS, Lambda, IAM is a proposal only).
- Which screens Google Cloud and Azure get, and when either is added.
- Team or CI use of Studio.
- An accessibility standard Studio is held to.
- Studio's voice and personality.

## Brand Commitments

Binding: the names "EmuForge" and "EmuForge Studio", and the symbol: the head and neck of an emu in profile,
facing right, with a crest of pointed feathers at the back of the crown, an almond eye cut out as a hole, a pointed
beak and a neck curving down to the left, as one closed silhouette in one flat colour (`brand/symbol.svg`; the
owner's decision in issue #36).

Not commitments: the tile the symbol sits on, the lock-ups (the compact and the primary logo), the app icons, the
social image, their colours, their letters and their proportions, and the line "Your free, local cloud workspace",
which is used on the social image only. They are Studio's design and change by the usual stages. No voice is
binding.

## Evidence on Hand

- The brand assets exist as files in `studio/brand/` (the symbol, the four logos, the app icons with their PNGs, the
  social image and its PNG) and `studio/public/` (the favicon as SVG and ICO, the Apple touch icon); `DESIGN.md`,
  The logo, lists them. `bun run brand` draws them from one geometry.
- No customers, testimonials, case studies, benchmarks, pricing or press exist. Do not invent them.
- What EmuForge does is shown by its own checks against a real emulator (`tests/integration/`), not by claims.

## Product Principles

1. **Show the emulator as it is.** Real state from the real emulator, whoever created it; an unsupported operation
   is stated, never hidden or faked.
2. **Local and safe.** Nothing leaves the machine for real AWS; the only upstream is the local emulator.
3. **Studio's own, the provider's own.** Studio's own screens are Studio's; inside a provider's area the user finds
   the structure and flow of that provider's console, not a copy of it, and neither layer leaks into the other.
4. **Built for more than one cloud.** AWS is the first provider, not the only one; adding a provider does not
   change Studio's own screens or another provider's area.
5. **Simple first.** Add complexity only when a real need appears.
