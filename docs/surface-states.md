# Surface state composition

Use one state composition for a page, pane, details area or compact list line. A surface explains what is happening and offers the next useful action; retained data stays visible while its owner refreshes it.

This page describes **0.3 development source**, not completed platform or live-fidelity certification.

## Core and shared owners

The app consumes [`SurfaceStateCard`](../apps/ui/sources/components/ui/surfaces/SurfaceStateCard.tsx) through `@/components/ui/surfaces`. It admits empty, loading, success, error, warning, unavailable and denied states, with translated title/reason, a primary action, optional quiet secondary action, note/help, present-tense live information and diagnostic details.

[`SurfaceStateSizeProvider`](../apps/ui/sources/components/ui/surfaces/surfaceStateSize.tsx) sets `pane`, `details`, `page` or `phone` once at the container. A card's explicit size wins; outside a provider the existing unsized composition remains. `size="line"` is the compact in-list composition. Shared size/type/line metrics come from [`presentation/state/InfoState.tsx`](../packages/plugin-ui/src/presentation/state/InfoState.tsx); change that owner rather than hand-sizing a consumer.

Plugins use the public Plugin UI state components. Both adapters consume the shared state frame, compact line and diagnostic disclosure renderers in `InfoState.tsx`; placement and disclosure are not consumer-owned copies. App-specific `SurfaceStateCard` is a host composition, not permission to import app internals into a plugin or claim all its props exist on each public component. Exact public props are package-owned. Public `ErrorState` distinguishes error, unavailable and denied states and supports compact lines. Static failure states stay silent by default; a caller can explicitly request an announcement for a lifecycle transition, without announcing the diagnostic disclosure again.

Notices above retained content share [`HappierBanner`](../packages/plugin-ui/src/presentation/content/Foundation.tsx): the app's `AttentionBanner` binds its theme, actions and diagnostic disclosure, and the public `Banner` binds plugin text and glyphs. The shared renderer owns the tint, outline and responsive action placement. Whole-surface states continue to use the state-card composition.

Progress and capacity bars share `HappierProgress` in the same presentation module. The app's `MeterBar` supplies the domain's fill and colours; a capacity meter stays silent while named progress reports its value. Numbered setup and checklist markers share [`HappierStep`](../packages/plugin-ui/src/presentation/content/Step.tsx) and its marker renderer. Adapters retain their own step decisions, labels, actions and details.

## Retained content and recovery

[`SurfaceFreshnessLine`](../apps/ui/sources/components/ui/surfaces/SurfaceFreshnessLine.tsx) presents the retained observation's time, refresh/reconnect reason and optional recovery action. Show it alongside retained content, under the header; when there is no retained content, show the appropriate loading/error/unavailable card instead. It and the public Plugin UI freshness component consume the same `HappierFreshnessLine` renderer and freshness-text formatter. Domain adapters still own observation timestamps and recovery actions.

Loading narration and diagnostic disclosure belong to the composition. The card does not own retries, availability, permissions or the underlying request lifecycle. Supply truthful state from that domain's owner, stop live activity at its terminal outcome and keep technical codes behind details. Avoid a second consumer-local spinner/error parser or timer for the same work.

Plugin Resource hooks retain their store snapshot when host mount activity turns inactive, release their read/watch subscription, and refresh through the same owner when activity resumes. Providers without a host activity fact keep their existing live behavior. Imperative `hostApi.watchResource` subscriptions remain caller-owned until disposal; view consumers should use the Resource hooks rather than create another presentation-driven polling lifecycle.

## Related

[Collection presentation](collection-presentation.md), [Plugin platform](plugin-platform.md), [DESIGN.md](../DESIGN.md), [UI instructions](../apps/ui/AGENTS.md).
