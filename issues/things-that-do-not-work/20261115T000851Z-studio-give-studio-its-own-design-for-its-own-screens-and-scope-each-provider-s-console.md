Issue-Id: 16
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|style-layers|provider-scoped
Issue-Check-Ids:
Issue-Commit: 338dabcc4d1cb701adb3997baaaa0872118c8d96

# Give Studio its own design for its own screens and scope each provider's console style to that provider's area

> Identified against commit `338dabcc4d1cb701adb3997baaaa0872118c8d96`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's style has two layers, and today it has one.

- **Studio's own layer.** The parts that exist only in Studio (its frame, the home or dashboard, settings,
  connection status, and later the IAM simulation and Verify results) are Studio's own design. They are original:
  they do not imitate any cloud provider's console.
- **The provider layer.** Inside that frame, the area of a cloud service provider looks and behaves like that
  provider's console. AWS is the only provider today, so entering the AWS area gives an AWS-style console
  (Cloudscape, scored against the AWS console reference specs). When another provider is added (Google Cloud,
  Azure), its area follows its own console, not the AWS one.

What exists instead: the whole of Studio is one AWS-console-style application. The outermost frame is the
Cloudscape `AppLayout` with `TopNavigation` and a `SideNavigation` that lists the AWS services at the root; the
home screen is built from Cloudscape components and tokens; Cloudscape's global styles and colour mode are applied
to the whole document. The guides require this: `studio/AGENTS.md` allows no component library and no styling
besides Cloudscape anywhere, and `studio/references/critique.md` tells a `native` screen to follow the AWS
console's conventions and forbids "a new visual language". Nothing in the code or the guides knows that a
provider is one of several: AWS service routes sit at the root (`/s3`), with no provider above them.

Reference: for the provider layer, that provider's console (for AWS, the reference specs of
`studio/references/console-reference.md`). For Studio's own layer there is no reference; the `plan` designs it and
the impeccable critique scores it (`studio/references/critique.md`), as for any `native` screen.

## Evidence

```
$ grep -n -E "looks and behaves|No second styling|Cloudscape design tokens only" studio/AGENTS.md
8:A web console for the local emulator that looks and behaves like the AWS console where an AWS console screen
17:- No second styling system. No Tailwind, no CSS-in-JS, no component library next to Cloudscape.
62:- Style with Cloudscape design tokens only. No hardcoded color, spacing or font. No CSS that restyles a
$ sed -n 61,62p studio/references/critique.md
A native screen still follows the AWS console's conventions wherever one applies: the same layout shell, the
same table, form and flash patterns. It is new content in a familiar frame, not a new visual language.
$ grep -n -E "AppLayout|global-styles" studio/src/app/shell.tsx studio/src/app/color-mode.ts studio/src/main.tsx
studio/src/app/shell.tsx:1:import AppLayout from '@cloudscape-design/components/app-layout';
studio/src/app/color-mode.ts:1:import { applyMode, Mode } from '@cloudscape-design/global-styles';
studio/src/main.tsx:1:import '@cloudscape-design/global-styles/index.css';
$ sed -n 12,13p studio/src/app/services.ts
  { label: 'Amazon API Gateway', route: '/apigateway' },
  { label: 'Amazon CloudWatch', route: '/cloudwatch' },
```

The home screen of issue #3 was scored as a `native` screen under that rule (final 29/40), that is, as new content
inside the AWS console's frame.

## Steps to Reproduce

1. Build and serve Studio (`cd studio && bun run build && bun run serve`) and open `/`.
2. The frame around every screen, Studio's own home included, is the AWS console's: Cloudscape top navigation,
   the AWS service list as the root side navigation, Cloudscape typography and colours.
3. Open `/s3`: an AWS service is a root route; there is no provider area it belongs to.

## Expected

- Studio's own screens (frame, home or dashboard, settings, connection status) have a design of their own that is
  not the AWS console's: the frame around the application is not the Cloudscape `AppLayout`, and these screens
  pass the impeccable critique as Studio's own design, in light and dark.
- AWS is reached as one provider area inside Studio's frame. Every AWS service screen lives in that area, and
  inside it the screen looks and behaves like the AWS console: Cloudscape components and tokens, the reference
  spec and structure score rules unchanged.
- A provider's console style does not leak out of its area, and Studio's own style does not restyle the inside of
  a provider area: Cloudscape's styles and colour mode apply only inside the AWS area.
- The structure has a place for a further provider with a console style of its own: adding one needs no change to
  Studio's own screens and none to the AWS area. No second provider is built here.
- What issue #3 delivered keeps working in the new structure: the connection status states, the service list
  with "no screen yet", "page not found", and every `studio.*` flow check (moved or rewritten by the `pm`'s
  recorded decision where a route or a frame element they name changes).
- The guides say the same thing as the code: `studio/AGENTS.md`, `studio/references/workflow.md`,
  `critique.md` and `console-reference.md` describe the two layers, which rules apply in which (Cloudscape-only
  inside the AWS area; Studio's own design system outside it), and how a screen's grade follows from the layer it
  is in.

## Out of scope

- Building a second provider (Google Cloud, Azure) or any screen of one.
- New AWS service screens; each comes with its own issue.
- Engine, CLI, IAM and Verify changes. If the provider areas need something from the engine, that is a separate
  issue in its module.
- Which original design Studio gets: the `plan` designs it and the critique scores it; the owner does not pick or
  approve designs.
