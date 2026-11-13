# TASK 1A.3 — Visible ambient glow and container depth

## Completion

**PASS — implementation, browser visual inspection, and technical validation completed. Owner visual acceptance remains pending.**

Initial `git status --short`: empty (clean working tree). No supplied screenshot file was available in the workspace; fresh production-browser baselines of the actual Dashboard and Billing pages were captured and inspected before editing.

## Root cause, verified in Chromium

At 1440×900, the previous main container occupied x=240 through 1416, starting at y=72 immediately below the header. It had an opaque `rgb(248, 243, 233)` background, no left/top gutter, and only 24px exposed on the right. Border radius was 16px. The glow wrapper had `overflow: visible`, so ancestor clipping was not the problem.

The old gradients spanned the viewport workspace with centers at 18%/85% and 90%/15%. Both strongest regions were beneath the opaque main panel. The primary green center was roughly x=456/y=776, not in the exposed gutter; the warm center was also covered. Only faint distant tails reached the right edge. Their 12%/5% peak alpha values further diminished those tails. The negative-z layer did render inside the isolated wrapper, but rendering a measurable effect was insufficient for ordinary visual recognition.

TASK 1A.2 therefore failed visually because it combined **covered gradient peaks, minimal exposed background, and weak edge intensity**. It did not fail because the CSS was absent or because of clipping. Its previous pixel-level evidence did not establish owner-acceptable visibility.

## Layering and placement correction

- Removed the glow class from the header/workspace wrapper and placed it on a dedicated frame around the existing `main` landmark. This is one shared, persistent wrapper for all six routes.
- `.bhms-ambient-glow`: relative positioning and isolated stacking context, with compact responsive padding.
- `.bhms-ambient-glow::before`: fixed below the unchanged 72px header, `z-index: 0`, `pointer-events: none`, no animation, and viewport-bounded geometry. Desktop left offset remains 240px to avoid painting over the sidebar.
- `.bhms-ambient-glow > main`: relative positioning and `z-index: 1`. No negative-z arrangement remains. The main surface stays opaque, retaining its existing theme color and 16px radius.
- Gradient peaks now sit at exposed left and upper-right workspace edges. Fixed pixel-sized ellipses keep their falloff stable when route content heights differ.
- A low-opacity, broadly diffused outer shadow adds elevation. There are no blur filters, colored borders, per-card effects, or new dependencies.

## Final effect values

| Effect | Color/token | Alpha / geometry |
| --- | --- | --- |
| Primary glow | Forest Green `#1D4A35`, existing `--forest-green` | 25% peak; ellipse 320px × 680px at 0% / 60%; transparent at 75% |
| Secondary glow | Tomato Red `#F2462E`, existing `--tomato-red` | 10% peak; ellipse 400px × 340px at 100% / 0%; transparent at 75% |
| Tablet/desktop depth shadow | Existing Forest Green | 8%; `0 12px 32px` |
| Below 768px | Both gradients | Overall opacity 0.6: maximum individual-layer alpha 15% green / 6% tomato |
| Below 768px depth shadow | Existing Forest Green | 5%; `0 6px 18px` |

All brand and theme variables, button/status colors, typography, sidebar, header height, navigation spacing, cards, tables, and internal content padding remain unchanged. No feature page, domain model, financial fixture, billing calculation, allocation, receipt record, or persistence file was edited.

## Exact gutter adjustments

The previous main margins are replaced by frame padding:

| Viewport | Frame top / horizontal / bottom | Difference |
| --- | --- | --- |
| Desktop ≥1024px | 24px / 24px / 24px | Adds 24px left/top, retains 24px right; bottom grows from 16px to 24px |
| 640–1023px | 16px / 16px / 16px | Adds 16px top; side/bottom spacing retained |
| Below 640px | 8px / 8px / 16px | Adds 8px top; side/bottom spacing retained |

Measured main widths: 1152px at 1440px, 736px at 1024px, 736px at 768px, 374px at 390px, and 344px at 360px. At desktop the width decreases by only 24px: about 2.0% at 1440px and 3.2% at 1024px. Tablet/phone widths are unchanged. Existing responsive module layouts and contained wide-table scrolling are retained.

## Actual screenshot comparison

Captured viewport-size images at normal device scale, rather than using tiny pixel differences as the acceptance criterion:

- Before: Dashboard and Billing, 1440×900.
- After: Dashboard and Billing at 1440, 1024, 768, 390, and 360px (900px high).
- After: every remaining module at 1440×900.
- Regression run also captured full-page images for all six modules at 1440px and 390px.

Inspected the before/after Dashboard and Billing screenshots directly. The old surface is almost flush against the sidebar/header and reads as flat. The corrected surface has visibly exposed green diffusion along its left edge, a smaller warm highlight at the upper-right, and soft container elevation. This is noticeable at ordinary desktop screenshot scale without zooming or pixel comparison. There is no neon ring or new hard colored outline. The existing subtle border remains.

Also inspected all four remaining route screenshots at 1440px, Dashboard at 1024px and 390px, Billing at 768px and 360px. The effect is consistent across all six routes, quieter on phones, and leaves content opaque/readable. Final judgment of its aesthetic strength belongs to the owner.

Artifacts (outside the repository):

```text
C:/Users/User/AppData/Local/Temp/opencode/bhms-depth-before-dashboard-1440.png
C:/Users/User/AppData/Local/Temp/opencode/bhms-depth-before-billing-1440.png
C:/Users/User/AppData/Local/Temp/opencode/bhms-depth-after-{route}-{width}.png
C:/Users/User/AppData/Local/Temp/opencode/bhms-depth-check.cjs
```

## Responsive, accessibility, and transition verification

Playwright Chromium ran against the final production build served locally by Vite preview:

| Width | All six routes, active nav, stable shell, no page overflow | Axe WCAG A/AA |
| --- | --- | --- |
| 1440px | PASS | No violations |
| 1024px | PASS | No violations |
| 768px | PASS | No violations |
| 390px | PASS | No violations |
| 360px | PASS | No violations |

Verified that the same glow host persists while navigating all six routes under normal motion. The decoration has no animation; the existing route wrapper retains its 200ms fade, final opacity, and 8px rise implementation. Reduced motion still disables route animation. Header, sidebar, and main landmark retain their DOM identity.

Additional checks passed: tenant-dialog viewport bounds and axe scans at all five widths; keyboard focus indicator; mobile menu Escape and focus return; saved notes/room changes after reload; occupied-room filtering; October electricity history; receipt preview; restore cancellation/confirmation; no runtime or console errors. Decorative `pointer-events: none` and explicit 0/1 layering are verified through computed styles. Content text, cards, tables, and status badges retain their original foreground/background colors.

Automated accessibility results are distinct from screenshot inspection and owner approval. Safari, Firefox, real hardware, and assistive-technology user testing were not performed.

## Required command results

| Command | Actual result |
| --- | --- |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS, 72 tests across six files |
| `git diff --check` | PASS, normal LF/CRLF notices only |

## Files and final Git status

```text
 M src/components/layout/admin-shell.tsx
 M src/styles/globals.css
?? docs/task-1a-3-report.md
```

No blocking visual defect was found in inspected Chromium layouts. The left glow is intentionally stronger than the warm highlight; phone exposure is intentionally narrower and quieter. Owner review of the corrected intensity and depth is still required. No commit, push, deployment, or next milestone was performed. Stopped for explicit owner approval.
