# Contributing

Use the Node.js version and setup commands in README.md. Before submitting a change, run `npm run lint`, `npm test`, and `npm run build`.

## Design and accessibility

Target WCAG 2.2 AA. Review the components and user flows you change. Record the evidence and distinguish source checks from browser checks; automated checks do not establish conformance.

- Keep existing colour, typography, spacing, and surface tokens in `src/styles/globals.css`. Verify text contrast of at least 4.5:1 (3:1 for large text), and 3:1 for essential UI boundaries and focus indicators.
- Give every input a persistent label. Identify required and optional fields, connect help/error text with `aria-describedby`, use `aria-invalid` for errors, and focus the first invalid field after submission. Preserve entered values when validation fails.
- Use native controls and existing Radix components. Check Tab/Shift+Tab, Enter/Space, arrow keys in menus, Escape, dialog focus containment, and return of focus after dismissal.
- Provide visible keyboard focus that stays clear of the sticky header. Check forced colours, reduced motion, 200% zoom, and narrow screens without page-level horizontal scrolling.
- Give icon-only actions accessible names. Hide decorative graphics from assistive technology. Announce result counts, asynchronous status, and failures without moving focus unnecessarily.
- Explain destructive actions and their scope before confirmation. Start focus on the safe action. Never describe a preview as a saved record or claim a download completed when only requested.
- Check changes with NVDA on Chrome and VoiceOver on Safari before production release. Record device, browser, flow, and observed issues; do not claim checks that were not performed.

## Prototype boundaries

Use fictional data. This app currently stores sample records in one browser; it has no authentication, backend, or payment processing. Preserve the financial calculations, audit records, and payment review/confirmation steps. Clearly label unavailable workflows and preview forms.
