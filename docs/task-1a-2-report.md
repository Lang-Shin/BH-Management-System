# TASK 1A.2 — Subtle ambient glow

## Completion

**PASS — technical implementation and verification complete. Owner visual acceptance pending.**

Initial `git status --short` was empty: the working tree was clean. No reference screenshot was available in the workspace; implementation follows the written description of soft, diffused edge lighting.

## Existing implementation

- Tailwind 4 uses CSS-first theme configuration through `@tailwindcss/vite`; there is no standalone Tailwind config.
- `src/styles/globals.css` defines the existing Oat Milk (`#EEE5D4`), Forest Green (`#1D4A35`), and Tomato Red (`#F2462E`) variables.
- Shared `AdminShell` contains the sidebar, sticky header, opaque rounded main surface, and pathname-keyed route content. All six admin pages share it.
- Existing main surface is `#F8F3E9`, with a 16px radius, border, and responsive gutters. Shared radius token is 14px. No existing shadows or radii were changed.
- Desktop navigation begins at 1024px; phone/tablet layouts use the existing drawer. Route content uses a 200ms fade and 8px rise, disabled under reduced motion.

## Minimal implementation

One class, `.bhms-ambient-glow`, was added to the existing shared workspace wrapper. Its `::before` pseudo-element renders two radial gradients behind the opaque main container:

| Layer | Existing color token | Peak alpha | Position | Transparent stop |
| --- | --- | --- | --- | --- |
| Primary | Forest Green `#1D4A35` | 0.12 | 18% horizontal / 85% vertical | 70% |
| Secondary | Tomato Red `#F2462E` | 0.05 | 90% horizontal / 15% vertical | 55% |

`color-mix(in srgb, var(...), transparent)` reuses the brand variables without replacing or duplicating them. Below 768px the entire decoration uses opacity 0.65, producing maximum individual-layer alpha of 0.078 green and 0.0325 red. These alpha values decay smoothly across each gradient.

The wrapper uses `isolation: isolate`. The fixed pseudo-element uses `z-index: -1` and `pointer-events: none`, starts below the existing 72px header, and stays within viewport bounds. At desktop widths it starts at the existing 240px sidebar boundary. It does not use blur filters, shadows, timers, animation, additional DOM elements, or new dependencies.

The effect appears only through exposed outer gutters/rounded edges. It is deliberately restrained because existing spacing is preserved. Header, main surface, table/card surfaces, typography, buttons, sidebar, badges, all existing tokens, and business logic are unchanged.

## Automated validation

All required commands executed successfully:

| Command | Result |
| --- | --- |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS, 72 tests in six files |
| `git diff --check` | PASS, normal LF/CRLF notices only |

No implementation-mirroring unit tests were added for this CSS-only decoration. Existing integration/domain/storage tests ran; browser checks verify the actual rendered effect.

## Actual production-browser verification

Playwright Chromium tested the production build served locally with Vite preview. Existing temporary Playwright/axe tooling was used outside the repository.

| Width | All six routes / active navigation / stable shell / no page overflow | Axe WCAG A/AA scans | Glow pixel/layout comparison |
| --- | --- | --- | --- |
| 1440px | PASS | No violations | PASS |
| 1024px | PASS | No violations | PASS |
| 768px | PASS | No violations | PASS |
| 390px | PASS | No violations | PASS |
| 360px | PASS | No violations | PASS |

Enabled/disabled gradient screenshots at all five widths show changed outer-gutter pixels and zero changed pixels in the sampled main-content interior (x inset 20px, viewport y 100–849). Main container bounds are identical. Maximum sampled gutter-channel changes were 9/255 desktop/tablet and 6/255 phone: visible but subtle. The disabled comparison removes only the gradient background, preserving the compositing layer.

Verified computed fixed positioning, negative stacking level, disabled pointer events, mobile intensity reduction, and no decoration animation. Navigation through all six pages retains the same glow host under normal motion. Existing 200ms route animation, final opacity, and reduced-motion behavior pass regression checks.

Accessibility/interaction checks also passed for tenant-dialog bounds and axe scans at all five widths, keyboard focus indicators, mobile menu Escape/focus return, and drawer layering. Existing note/room persistence, historical electricity details, receipt preview, and restore cancel/confirm interactions passed. No browser console/runtime errors were observed. No domain models, financial records/calculations, allocations, navigation logic, or persistence code changed.

## Screenshot review and limits

Captured fresh six-module screenshots at 1440px and 390px, Dashboard at the other requested widths, plus glow-on/off viewport comparisons at all five widths and the open 360px drawer. Inspected glow Dashboard screenshots at 1440px and 390px and the narrow drawer screenshot. Content remains readable; no hard glow boundaries or saturated patches were observed.

Artifacts are outside the repository:
- `C:/Users/User/AppData/Local/Temp/opencode/bhms-glow-*.png`
- `C:/Users/User/AppData/Local/Temp/opencode/bhms-redesign-*.png` (fresh regression captures)
- `bhms-glow-check.cjs` and `bhms-redesign-check.cjs` in that same temporary directory.

The narrow existing gutters limit how much glow is visible, particularly on phones; this is intentional, with no spacing changes. Owner review of subtlety/intensity remains pending. Safari, Firefox, and physical-device visual testing were not performed. Automated accessibility scans and technical checks do not constitute owner visual approval.

## Changed files and final Git status

```text
 M src/components/layout/admin-shell.tsx
 M src/styles/globals.css
?? docs/task-1a-2-report.md
```

Only one class in the shared shell and the new decorative CSS selectors/media rules were changed in application code. No dependencies added. No commit, push, deployment, or next milestone performed. Stopped for owner review.
