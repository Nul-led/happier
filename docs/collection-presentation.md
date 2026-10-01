# Collection presentation ownership

A Collection presents keyed items through one headless model, shared list/table/board/grid anatomy and responsive detail composition. The caller owns the data, route, actions and view preference. The presentation layer owns how those facts fit together.

This page describes **0.3 development source**. It promotes implemented owners, not the historical Collection plan's rollout or unverified fidelity claims.

## Model and presentation

[`useHappierCollection`](../packages/plugin-ui/src/presentation/collection/useCollection.ts), exported from `@happier-dev/plugin-ui/presentation`, composes grouping, order, filter, window completeness, focus, selection, expanded keys, route-controlled `openKey`, visit memory and drafts. Multiple selection reuses the existing [`multiSelection.ts`](../packages/plugin-ui/src/presentation/collection/multiSelection.ts) store/reducer. The model calls `onOpenChange`; it does not navigate or persist domain items.

Initial landing is optional: when the consumer supplies visit memory, items are ready and the measured mode is split, the model chooses the last visited available item, otherwise the first. Overview indexes may omit this policy. A draft uses a separate key and title store; it is not silently persisted as a real item.

The public [`Collection`](../packages/plugin-ui/src/components/Collection.tsx) draws one `CollectionAnatomy` through the existing [`List`](../packages/plugin-ui/src/components/List.tsx) engine and card composition. `collectionTable.ts` owns [presentation and detail decisions](../packages/plugin-ui/src/presentation/collection/collectionTable.ts): table/list can split when their minima fit; board/grid use the host details pane when available and otherwise push the detail. A pane host's placement takes precedence over an in-page split. Before measurement the composition does not claim a wide layout.

Use the actual `presentation` and `detail: 'auto' | 'none'` API; do not copy old plan examples that propose `views`, a generic `drawer` mode or `detail: 'peek'`. Expanding a row uses the disclosure/peek owner. Switching presentation can remount cells; keep the model, route and required detail continuity stable rather than promising universal row persistence.

`detailHeader(key)` supplies the selected item's title, optional subtitle and actions to the host details band. The host owns Close. `renderDetail(key, { headerHosted })` renders the same detail body in each container; when the header is hosted, omit the body's duplicate title and close controls. In a pushed or split detail, the caller keeps its inline header and route-owned back behavior.

## Layout and host bindings

[`HappierListDetailLayout`](../packages/plugin-ui/src/presentation/collection/ListDetailLayout.tsx) owns split geometry and publishes the measured mode through [`collectionLayout.tsx`](../packages/plugin-ui/src/presentation/collection/collectionLayout.tsx). Consumers read `useHappierCollectionLayout` or `useHappierCollectionIndexView`; they do not mirror layout mode into another state/context.

The app's [`SettingsCollectionLayout`](../apps/ui/sources/components/settings/shell/SettingsCollectionLayout.tsx) binds that geometry to the nested route stack and keeps its detail stack mounted across wide/narrow composition. It is an adapter over the shared owner, not another split engine. Host motion comes through the Plugin UI presentation host; plugins do not acquire Reanimated or app-internal navigation dependencies to reproduce it.

## Contributor rules

- Consume the existing model, List engine, Collection and detail geometry before creating a page-local generic collection. A domain-specific composition is fine; a duplicate selection/layout/visit-memory owner is not.
- Keep data acquisition, currentness and mutations at the caller's domain owner. Report partial or unavailable windows honestly rather than implying a complete result after filtering loaded rows.
- Derive every presentation from one item anatomy and stable keys. Controls inside a card retain their own press/focus target rather than opening the card accidentally.
- Use shared presentation metrics and semantic theme/accessibility bindings. Do not copy geometry or motion constants from a plan or specimen.

## Related

[Plugin platform](plugin-platform.md), [surface states](surface-states.md), [DESIGN.md](../DESIGN.md), [UI instructions](../apps/ui/AGENTS.md).
