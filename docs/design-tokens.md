# Design tokens

Version 2.0.0 · 2026-11-17. Components come from Radix Themes (`@radix-ui/themes`); the app-level tokens and shared patterns live in `src/styles/globals.css`.

| Token | Purpose | Use / avoid |
|---|---|---|
| Theme: `accentColor="green"`, `grayColor="sand"`, `radius="medium"` | Radix Themes configuration in `AppProviders` and `AppRouter` | Change here, not per component. |
| `--accent-1…12` (overridden for green) | Forest green `#1D4A35` scale; step 9 is the primary action | Primary buttons, active navigation, focus. |
| `--gray-1…12` (sand) | Warm neutral surfaces, borders and text | Borders are `--gray-5`; secondary text uses `color="gray"`. |
| `--red-*` | Money owed, overdue, destructive actions | Only for meaning, never decoration. |
| `--color-background`, `--color-panel-solid` | Page and panel surface | Two levels only; separate them with a 1px border, not a shadow. |
| `--sidebar-width`, `--topbar-height`, `--content-max` | Shell dimensions | |
| `--route-duration`, `--route-offset`, `--route-ease` | Route entrance motion | Respect reduced motion; do not delay data or confirmation. |

Shadows are reserved for floating layers (popover, dialog), which Radix Themes already provides. Do not add gradients, glows or per-component colours. Introduce a token only when a value has a repeated product role.

## Changelog

### 2.0.0 — 2026-11-17

Replaced Tailwind and the local shadcn layer with Radix Themes. Removed the Tiny5 Duo and Lilita One display fonts; Luckiest Guy remains for the wordmark only. Replaced brand primitives (`--oat-milk`, `--forest-green`, `--tomato-red`) with the Radix accent, gray and red scales. Removed gradient, glow and inset-highlight surfaces.

### 1.0.0 — 2026-11-16

Documented the original brand, colour, radius, and route tokens.
