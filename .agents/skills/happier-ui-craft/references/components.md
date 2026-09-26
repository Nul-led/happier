# Components and owners

Search the code before trusting this list; owners move. If a concept is missing here, find its
owner, do not create one. Paths are under `apps/ui/sources/` unless stated.

## Values

| Concern | Owner |
| --- | --- |
| Colours, surfaces, borders, shadows | Unistyles theme tokens (`theme/`); no raw colours, no new tokens without a theme-profile decision |
| Type scale and weights (`regular`, `medium`, `bold`) | `constants/Typography.ts` + app `Text` / `TextInput` |
| Page column, title block, section spacing, sheet radius and insets, row insets, back-arrow gutter, stack breakpoint | `components/ui/lists/pageListMetrics.ts` |
| Row density (a section sets it with `ItemGroup density`) | `components/ui/lists/itemDensityMetrics.ts`, `useResolvedItemDensity.ts` |
| Motion durations and easing | `components/ui/motion/index.ts` (`motionTokens`) |
| Content width | `components/ui/layout` (`layout.ts`, `contentWidthMode.ts`) |

## Structure

| Need | Use |
| --- | --- |
| A configuration or detail page | `ItemList presentation="page"` + `PageHeader` (`components/ui/layout/PageHeader.tsx`: title, description, `actions`, `leading` mark, `meta` facts with icons, and a back slot filled by the navigation chrome); settings use `SettingsPageHeader` |
| A section | `ItemGroup` with `title`, `description`, optional `action` (drops beneath the title on narrow widths); `surface="none"` for sheetless content (tiles, a button row) |
| A row | `Item` |
| Free content inside a sheet | `SectionContentRow` |
| A searchable setting row | `SettingRow` / `SettingAnchor` (`components/settings/shell/SettingRow.tsx`) + a `defineSettingsPage` declaration |
| A generic collection (list, table, board, grid + detail containers) | The Collection in `@happier-dev/plugin-ui/presentation` (spec: `.project/plans/2026-08-12-triage/design/COLLECTION.md`): the `useHappierCollection` model (landing on the last visited item, visit memory, draft items, layout mode); never a page-local one |
| List + detail | `HappierListDetailLayout` (the Collection's split geometry); pages read its mode with `useHappierCollectionLayout`, index routes with `useHappierCollectionIndexView` |
| The list pane of a list + detail collection | `CollectionList` (`components/ui/lists/collection/CollectionList.tsx`, the app binding of `HappierCollectionList`) with `CollectionListGroupLabel` and `CollectionDraftRow` |
| Expand in place | `ExpandableItem` (the app's motion binding of `HappierDisclosure`) |
| Empty: a whole page or pane, or one line in a list or rail | `EmptyState` (`layout="page"` / `"line"`; `primaryAction`, `actionUnavailableReason`) |
| Loading or failure of a whole surface | `SurfaceStateCard` (its `empty` kind renders `EmptyState`) |
| The mark at the head of an entity page or row | `PageHeaderMarkTile` (`appearance="glyph"` for a plain glyph) |
| Menus, pickers, tooltips | `Popover` + `FloatingOverlay`; searchable choices in a popover use `SelectionList` content full-bleed; compact pickers anchored to a chip use `portal.sizeToContent` |
| A form field | `FieldItem` / `FieldTextInput` (one field shape: `components/ui/forms/fieldBox.ts`); lists of values `StringListField` |
| A pressable surface | `HappierPressable` — its focus ring follows `:focus-visible` on web, so a mouse press never leaves a ring and keyboard focus always shows one |

## Control decision table

| The user is choosing… | Control | Owner |
| --- | --- | --- |
| On / off | Switch | `Item` with switch |
| One of 2–4 short options | Segmented, all visible | `SegmentedChoiceItem` (`SegmentedTabBar`) |
| One of many, or long labels | Bordered field select | `DropdownMenu` (field trigger on pages) |
| A value on a scale with steps | Slider with end glyphs | `components/ui/forms/Slider.tsx` |
| Filter a list inside a rail or popover | Compact bordered search field (the same one as the settings sidebar) | `components/ui/forms/CompactSearchField.tsx` |
| Something that changes how the app looks | Visual tiles with real previews | `SelectionTiles variant="visual"` |
| One of a few actions that deserve space | Action tiles | `SelectionTiles variant="action"` |
| A destination | Summary + chevron | `Item` with `detail` + chevron |
| An operation | Inline button | `RoundButton` (`display` primary / secondary / destructive) |
| A machine scope | Header chip | `MachineAdministrationTargetSelector presentation="chip"` |
| Rare operations on an entity | `⋯` menu | `IconButton` + `Popover` |

Rules that come with the table:
- Visual previews render the real component (session row, avatar, theme window) at static props.
  No subscriptions, no RPCs, no drawn replicas.
- A slider exists only for a real ordered scale; its steps are the setting's real values.
- A "+" with more than one way to add is a menu, not a guess at the most common path.
- One primary `RoundButton` per view. Dark themes use an inverted primary (light fill, dark text);
  check that a filled secondary does not read as disabled, and use `display="destructive"` for the
  irreversible action.
- Visual tile rows fill the section width as equal tiles; action tiles wrap to one column on phones.

## Status and badges

- `StatusPill` for a short state next to a title (Beta, Saved, Installed). Neutral unless the state
  asks for attention.
- A dot only for trouble (needs sign-in, offline, failed). A green dot for "fine" is noise, except
  presence (online) where it is the identity of the state.
- Counts are quiet and tabular.

## Identity marks

- Agents, providers and services use their contributed brand marks through the catalog/registry
  owners (never branch on ids in generic UI). People use the avatar owner. Machines and devices use
  the device icons. A missing mark is a defect to fix at the catalog, not a blank space.
- **Row icons (rule b)** go through `Item`'s leading column (`icon`): one family, one size,
  `text.secondary`. Navigation rows and hub tiles have one; preference rows do not. Lane S2 owns the
  leading-column change in `Item`; do not size or colour row icons at the call site.
- **No bordered tile around a glyph.** A plain glyph (a machine, a pool, a house, a key) stands alone
  on the paper (`PageHeaderMarkTile appearance="glyph"`). Only a real mark — a logo, an avatar, a
  tinted monogram, a palette preview — sits on a shape, and that shape is a borderless fill. The same
  holds for empty states: the glyph is never in a tile or a ring.

## Plugins

Plugins build the same anatomy from `@happier-dev/plugin-ui` primitives. Do not reproduce host
anatomy inside a plugin, and do not add a host-only primitive a plugin would need; expose it.
