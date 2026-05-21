# Design

## Source of truth
- Status: Draft
- Last refreshed: 2026-05-21
- Primary product surfaces: Workspace sidebar, company tab, blueprint studio, run and approval views.
- Evidence reviewed: `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `apps/web/src/components/WorkspacePages.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/public/brand/*`.

## Brand
- Personality: Quiet, operational, exacting, and command-focused.
- Trust signals: Clear company scope, visible execution evidence, explicit OpenClaw boundaries, stable layout.
- Avoid: Marketing shells, decorative dashboards, hidden runtime identity, or dense metrics on surfaces that are meant to orient the workspace.

## Product goals
- Goals: Give one operator a structured command surface for autonomous agent blueprints, scoped by company.
- Non-goals: Replace OpenClaw runtime concepts or present Hiveward display labels as real agent identity.
- Success signals: Company context is obvious, blueprint actions stay inspectable, and run evidence remains available in the run surfaces.

## Personas and jobs
- Primary personas: Operators designing, running, and reviewing agent-team blueprints.
- User jobs: Pick the company context, shape a blueprint, run it, inspect outputs, and approve gated work.
- Key contexts of use: Repeated desktop work, local development, and runtime-backed smoke tests.

## Information architecture
- Primary navigation: Company scope, blueprint studio, runs, approvals, schedule, and supporting workspace pages.
- Core routes/screens: Company tab, company directory, blueprint canvas, run detail, approval inbox.
- Content hierarchy: The company tab is a brand/context surface. It should show only logo, company name, and business goal for a selected company. The company directory is a lightweight selection surface; company cards should show logo, name, business goal, and direct enter/delete actions rather than operational metrics.

## Design Principles
- Scope first: The selected company should be visually clear before blueprint work begins.
- Working surface over reporting surface: Operational metrics belong in run, approval, and dashboard views, not the company brand tab.
- Tradeoffs: Company pages can be sparse when that preserves focus and prevents the tab from becoming an information dump.

## Visual Language
- Color: Neutral application surfaces with restrained brand accent for interaction and selected state.
- Typography: Compact UI type for controls; larger editorial type is reserved for company identity or true hero moments.
- Spacing/layout rhythm: Dense in operational panels, generous on brand/context views.
- Shape/radius/elevation: Low-radius panels and restrained shadows; avoid nested cards inside major cards.
- Motion: Minimal and functional.
- Imagery/iconography: Use real company logos when available; fall back to a monogram.

## Components
- Existing components to reuse: Company switcher, company list cards, blueprint canvas controls, run/approval table patterns.
- New/changed components: Company tab brand poster in `CompanyPage`; company directory cards with explicit enter/delete actions.
- Variants and states: Selected company, no company selected, no companies available.
- Token/component ownership: Keep runtime and protocol details out of React display components; use shared contracts from `packages/shared`.

## Accessibility
- Target standard: Practical WCAG AA contrast and keyboard-accessible controls.
- Keyboard/focus behavior: Navigation and company selection controls must remain reachable by keyboard.
- Contrast/readability: Company name and goal need high contrast in both light and dark themes.
- Screen-reader semantics: Preserve image alt text and meaningful empty-state text.
- Reduced motion and sensory considerations: No required motion for comprehension.

## Responsive Behavior
- Supported breakpoints/devices: Desktop-first with usable tablet and mobile layouts.
- Layout adaptations: Brand poster centers and scales down at narrow widths.
- Touch/hover differences: Interactive controls retain visible states without relying only on hover.

## Interaction States
- Loading: Busy states should disable affected controls.
- Empty: Company tab explains when no company is selected or available.
- Error: Surface API/runtime errors in the relevant operational panels.
- Success: Successful selection should update the visible company context.
- Disabled: Disabled controls should remain legible and non-interactive.
- Offline/slow network, if applicable: Local mock paths should keep the UI inspectable.

## Content Voice
- Tone: Concise, operational, and concrete.
- Terminology: Use "company", "blueprint", "run", "approval", and "OpenClaw" consistently.
- Microcopy rules: Do not explain obvious UI mechanics inside the main working surface.

## Implementation Constraints
- Framework/styling system: React, TypeScript, Vite, CSS in `apps/web/src/styles.css`.
- Design-token constraints: Extend existing CSS variables and component classes before adding new layers.
- Performance constraints: Do not add dependencies or heavy assets for simple brand display.
- Compatibility constraints: Keep mock mode and Gateway-backed mode working.
- Test/screenshot expectations: Run web typecheck/build for frontend changes and visually smoke-test the local app when practical.

## Open Questions
- [ ] Whether company profiles need editable logo upload beyond the existing URL/label fields / product owner / affects future company directory work.
