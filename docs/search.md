# Search and Commands

Universal Search is the one query surface for commands, sessions, projects,
transcript messages, settings pages, workspace files, commits, and trusted
plugin entities, with platform-specific hosts (web/desktop modal, native
keyboard-seated overlay, the canonical `/search` route) and one contextual
session-list consumer. This page is the internal canonical description of its
current 0.3 development architecture. Published behavior lives at
`apps/docs/content/docs/organize/search.mdx`.

Status: implemented through production callers on the 0.3 development branch;
not part of a released stable version. The app-shell provider now opens the
universal modal or native route, `/search` renders the same controller, and the
session-list destination and escalation use that route. Source integration is
not a substitute for the plan's still-required loaded browser, iOS, Android,
accessibility, and Lane 09 evidence.

## Canonical owners

| Concern | Owner |
| --- | --- |
| Open/close, query context, shortcut handling | refactored app-shell search provider (`CommandPaletteProvider`); native routes the persisted `commandPalette.open` identity to `/search` |
| Command inventory | `buildCommandPaletteCommands` (navigation, recent sessions, settings, feature decisions, plugin Actions, keyboard labels); adapted to `SelectionList` sections by `buildCommandPaletteSelectionListSections` |
| Result list, input, selection, a11y, virtualization | `SelectionList` and `useSelectionListDynamicSections` |
| Universal section construction | `apps/ui/sources/components/appShell/search/buildUniversalSearchSections.tsx` — a thin adapter over domain owners, deliberately not a registry |
| Normalized result/target identity | `universalSearchResult.ts` (`UniversalSearchResult`, source-namespaced option ids, exact target facts) |
| Activation | `activateUniversalSearchResult.ts`, dispatching to the canonical session/project/file/SCM/settings/command/plugin owners after the host is dismissed |
| Route and presentation | `/search` (`UNIVERSAL_SEARCH_ROUTE`); `transparentModal` on iOS/Android, ordinary router presentation on web/desktop |
| Native keyboard geometry | `UniversalSearchNativeHost` + `universalSearchNativeGeometry` over the existing keyboard-aware screen, scrim, and safe-area owners |
| Session-list search | stable `SessionListSearchChrome` plus `sessionListSearchGroups` and `useSessionListMemorySearchAugmentation`; session rows only, with a `Search everything for …` escalation into universal Search |
| Home transcript execution | Lane 07 Home search route/service (explicit target, feature admission, capability readiness) |
| Daemon transcript execution | daemon memory owner (explicit server + machine, Unicode tokenizer, archived policy, removal/reconciliation) |
| Files / commits / settings / sessions / projects | existing workspace-file search, SCM owner, resolved settings catalog (Fuse), synchronized projections/catalogs — adapters only |
| Plugin declarations and execution | `contributes.searchProviders` in the contribution catalog + the existing Action dispatcher (`executeAction | openSurface`) |
| Feature admission | `packages/protocol/src/features/catalog.ts` via `useMemorySearchProvider`; see `feature-gating.md` |

## Data flow

1. An entry point (shortcut, sidebar Search destination, native action,
   `/search`, session-list escalation) opens the single search provider.
2. The provider builds the command inventory once per open and composes
   sections through `buildUniversalSearchSections`: static local sections
   (commands, sessions, projects) plus dynamic sections bound to explicit
   targets (transcript, files, commits, plugin providers).
3. Every remote/corpus section declares `visibleWhen: query is non-empty`, so
   an empty query is a pure UI state — bounded recents and suggested commands,
   zero wire requests.
4. `useSelectionListDynamicSections` owns per-section debounce,
   `AbortController`, and independent loading/error/success state; sections
   publish without blocking or clearing each other.
5. Selecting an option commits the result identity; the host dismisses, then
   activation re-resolves currentness at the canonical owner and awaits it.
   Failures surface through the canonical error owner — no fire-and-forget at
   the surface seam, no retargeting to the currently focused Home/machine.

Built-in adapters map results to `SelectionListOption` immediately. The
UI-internal `UniversalSearchResult` shape exists to keep target identity and
activation separate from presentation; it is not a wire protocol, a row
database, or an SDK type.

Immediate Session matching is metadata-only: canonical Session id/title,
project or workspace display label, path, tags, host, and machine metadata.
Arbitrary hydrated transcript and tool content is excluded from this local
haystack and belongs to the selected transcript provider. The existing bounded
first-user-message title fallback remains searchable because it has already
been promoted to the Session's visible canonical title; this does not admit any
other transcript body into immediate matching. Exact title/session/project
matches precede other metadata, then transcript-provider order, with outside
matches kept in the contextual `Other matches` group.

## Target scoping

Scope is Search-local, contextual, and exclusive, never a fanout. Opening the
surface captures the caller's exact Account/Home/session/machine/workspace
context. When another reachable Home or workspace is available, the compact
scope control changes only this Search instance; it does not change the app's
ambient focus. Session-list escalation carries that list's selected Home into
the same scope owner.

- Changing scope rekeys the existing SelectionList dynamic sections, whose
  cancellation and stale-publication fences retire the superseded work.

- Home transcript search targets the exact selected server/Home; the target is
  captured in result identity and activation, so a focus change mid-query
  cannot re-key or activate results under another Home.
- Daemon memory search targets the explicitly selected usable machine
  (`resolveDaemonMemorySearchTarget`), never `machines[0]`, never all
  machines.
- Files target the exact current workspace; commit search additionally stays
  within that workspace's current Git branch or current Sapling parent set.
  With no workspace present the section is omitted rather than pointed at an
  arbitrary one.
- Sessions/projects/settings read local synchronized projections; plugin
  providers target currently admitted plugin Actions.

There is no automatic all-Home or all-machine aggregation and no server-side
**universal aggregation** endpoint. Plaintext Personal Home transcript search
does have its own authenticated, feature-gated `POST /v1/home/search` endpoint;
it is one source-specific executor, not a general search coordinator.

## Feature versus capability

`search` (server-represented, fail-closed, on by default) admits Home
plaintext transcript search; `memory.search` admits daemon-local memory
indexing and its settings; `capabilities.homeSearch` is diagnostic only
(ready/indexing/unavailable) and never authorizes a request. Missing or
malformed feature data fails the Home provider closed while the shell and
unaffected sections stay usable. `useMemorySearchProvider` is the single
Home-versus-daemon decision seam for both the universal surface and the
session list; details in `feature-gating.md`.

## Privacy and storage

The two transcript providers are distinct privacy implementations:

- Home search reads plaintext envelopes into a rebuildable `search.sqlite`
  projection on the user's Home. `POST /v1/home/search` authenticates the
  present user, resolves that user's visible session ids, and applies those
  ids at query time; ACL/share state is not copied into the index. Each hit is
  message-granular, but its shared `summary` field contains a match-centered
  snippet rendered from pristine message text (or the complete text when it
  already fits), not a guarantee that the full message is returned. Storage
  policy admission uses the canonical enum/parser.
- Daemon memory indexes decrypted transcripts on the machine that owns them
  (light summary shards / deep chunks, optional local or remote embeddings).
  Derived rows are removed through the daemon removal/reconciliation owner
  when sessions are deleted, revoked, or excluded by archived policy; copy
  may promise exclusion from search, never secure physical erasure.

Neither path creates a server-side universal index. `docs/encryption.md`
owns the underlying storage/encryption contracts.

The workspace-file corpus cache is bound to the incumbent Account lifetime.
Account retirement clears reusable entries and fences late publication before
another Account can observe the same server/machine/root tuple.

## SelectionList sections, cancellation, and stale fencing

`SelectionList` remains the single input/query/list/a11y owner; Universal
Search extends it narrowly:

- `resultFiltering: 'host' | 'provider'` (default `host`): sections whose
  canonical executor already ranked results (FTS, settings Fuse, files,
  commits, plugin providers) choose `provider` so the host matcher cannot
  drop a legitimate non-literal match. Static menu-like sections keep the
  canonical host matcher; no new fuzzy algorithm.
- `inputPlacement: 'top' | 'bottom'` (default `top`): the native host seats
  the same canonical input at the bottom; no second `TextInput` or query
  state.
- `resolverKey` carries the full target identity (Account scope, Home/server,
  machine, workspace root, plugin generation). A changed key discards
  in-flight work and prevents cross-mount cache replay; sensitive sections
  either use no cross-mount cache or an explicit search/auth-lifetime adapter
  cleared on logout/Account replacement.
- Per-section `AbortSignal` threads into machine RPC, workspace-file RPC, and
  the Action dispatcher; stale responses after query/target/generation/scope
  changes are dropped by sequence fencing.
- Unavailable sources render as a typed, non-activatable empty-hint section
  (`indexing`, offline, disabled, unsupported) — never as disabled fake rows
  and never as a global error. Raw scores from different providers are never
  compared or displayed as one ranking.

## Plugin search providers

Plugins declare `contributes.searchProviders` with a minimal descriptor
(`id` + Action reference); title, availability, execution target, and
currentness come from the referenced Action. A query is a present-user `ui`
invocation through the existing Action dispatch seam with strict canonical
query/result schemas (`PluginSearchQueryV1`, `PluginSearchResultV1` with
required `truncated`), an `AbortSignal`, and the incumbent
`executeAction | openSurface` activation union. Plugin update, disable,
uninstall, or generation retirement removes and fences rows and activation.
There is no `api.search.register()`, no second executor, no provider-owned
rendering, and no streaming/result-delta protocol. Triage supplies the first
query Action and descriptor over its existing matcher; the universal production
host now consumes that projected section.

`contributes.searchProviders` is distinct from `composerReferences`
(query → composer insertion); the composer dispatcher, its trigger grammar,
and its cancellation behavior are intentionally untouched.

## Intentional exclusions

No universal database or second transcript index; no server-side universal
aggregation endpoint (the source-specific Home endpoint is retained); no
global score ordering or cross-provider dedupe; no all-Home or
all-machine fanout; no plugin renderers, preview pane, or second command
registry; no new shortcut identity (`commandPalette.open` persists, label
**Open Search**); no second search route (the standalone Memory Search
controller has been removed now that the universal route consumes its callers).

## Retained separate paths (not competing owners)

- `buildCommandPaletteCommands` — the command-section adapter under the
  universal surface.
- Composer autocomplete/`CommandMenu` and `composerReferences` — distinct
  caret-context pickers with deliberately different cancellation semantics.
- Settings catalog Fuse search, workspace file search, session-list metadata
  matching — domain-local matchers consumed by their adapters.
- Home and daemon transcript engines — distinct privacy/authority
  implementations behind one decision seam.
- CLI transcript search — a legitimate non-UI consumer of the same backend
  owners.
