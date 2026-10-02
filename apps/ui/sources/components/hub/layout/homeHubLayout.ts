/**
 * The app home's layout: which sections show and in what order, built-in sections and plugin
 * widgets in one list. The Account's stored value lists ids; this module is the one reader and
 * writer of that shape.
 *
 * - Built-in sections always have a place; the hideable ones can be switched off.
 * - A plugin widget is on Home when the person added it (its id is in `order`) or when it declares
 *   itself shown by default — and in either case only until they hide it. Otherwise it waits in
 *   Customize → Add widgets. A default-shown widget the person has not placed yet joins after the
 *   built-in sections.
 * - Ids this version does not know (a newer app's section, an uninstalled or disabled plugin's
 *   widget) are kept exactly where they are, so a write never drops them and a returning widget
 *   comes back to its place.
 */

import type { WidgetHomeDefault } from '@/sync/domains/plugins/ui/widgetContract';
import type { HomeHubLayoutIntent } from '@happier-dev/protocol';

/**
 * A built-in section as the layout sees it. The section table (`homeHubSections.tsx`) owns the rows,
 * their default order, titles and renderers; "Start" and "attention" are not hideable because
 * urgency surfaces there.
 */
export type HomeHubBuiltinDefinition = Readonly<{
    id: string;
    hideable: boolean;
    /** Off until the person turns it on in Customize (Machines: a detail most people never need on Home). */
    defaultHidden?: boolean;
    /** Comes after the widget row by default (Latest runs, Machines, Usage — lab `hindex` I1). */
    afterWidgets?: boolean;
}>;

export type HomeHubLayoutValue = Readonly<{
    order: readonly string[];
    hidden: readonly string[];
    sections?: Readonly<Record<string, Readonly<{ frameStyle?: 'card' | 'plain' }>>>;
}>;

/** What the layout needs to know about one installed widget. */
export type HomeHubWidgetInput = Readonly<{ key: string; homeDefault: WidgetHomeDefault }>;

export type HomeHubSection<W extends HomeHubWidgetInput = HomeHubWidgetInput> =
    | Readonly<{ kind: 'builtin'; id: string; hidden: boolean; hideable: boolean; frameStyle?: 'card' | 'plain' }>
    | Readonly<{ kind: 'widget'; id: string; widget: W; hidden: false; hideable: true; frameStyle?: 'card' | 'plain' }>;

export type ResolvedHomeHubLayout<W extends HomeHubWidgetInput = HomeHubWidgetInput> = Readonly<{
    /** Built-in sections (hidden ones flagged) and the widgets on Home, in order. */
    sections: readonly HomeHubSection<W>[];
    /** Installed widgets not on Home: Customize → Add widgets. */
    available: readonly W[];
}>;

export const HOME_HUB_DEFAULT_LAYOUT: HomeHubLayoutValue = Object.freeze({ order: [], hidden: [] });

const WIDGET_ID_PREFIX = 'widget:';
/** A dismissed "Get set up" step, recorded in `hidden` beside the sections: `setup:<stepId>`. */
const SETUP_STEP_ID_PREFIX = 'setup:';

/** A widget's id in the stored layout: `widget:<pluginId>/<localId>`. */
export function homeHubWidgetSectionId(widgetKey: string): string {
    return `${WIDGET_ID_PREFIX}${widgetKey}`;
}

function dedupe(ids: readonly string[]): string[] {
    return ids.filter((id, index) => ids.indexOf(id) === index);
}

/**
 * Every id with a place on Home, in order: the stored order (unknown ids kept in place), then the
 * built-in sections it lacks, then the default-shown widgets it lacks. Hidden sections keep their
 * place; `hidden` alone decides whether they draw.
 */
function placedIds(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
): string[] {
    const stored = dedupe(layout.order);
    const missing = (section: HomeHubBuiltinDefinition) => !stored.includes(section.id);
    const placed = [...stored, ...builtins.filter((section) => !section.afterWidgets && missing(section)).map((section) => section.id)];
    // Default-shown widgets the order lacks join the widget row: before the first section that follows it.
    const shownWidgets = widgets
        .filter((widget) => widget.homeDefault === 'shown')
        .map((widget) => homeHubWidgetSectionId(widget.key))
        .filter((id) => !stored.includes(id));
    const afterWidgets = new Set(builtins.filter((section) => section.afterWidgets).map((section) => section.id));
    const rowEnd = placed.findIndex((id) => afterWidgets.has(id));
    if (rowEnd < 0) placed.push(...shownWidgets);
    else placed.splice(rowEnd, 0, ...shownWidgets);
    return [...placed, ...builtins.filter((section) => section.afterWidgets && missing(section)).map((section) => section.id)];
}

function isBuiltinHidden(layout: HomeHubLayoutValue, hidden: ReadonlySet<string>, builtin: HomeHubBuiltinDefinition): boolean {
    if (!builtin.hideable) return false;
    // A default-hidden section the stored order has never placed has not been turned on yet.
    return hidden.has(builtin.id) || (builtin.defaultHidden === true && !layout.order.includes(builtin.id));
}

/**
 * The stored value every write starts from: every placed id in `order`, and the default-hidden
 * sections still off written into `hidden`. Once written, `hidden` alone decides, so placing a
 * default-hidden section in the order (any move does) never turns it on by accident.
 */
function materialize(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
): HomeHubLayoutValue {
    const stillOff = builtins
        .filter((builtin) => builtin.hideable && builtin.defaultHidden === true && !layout.order.includes(builtin.id))
        .map((builtin) => builtin.id)
        .filter((id) => !layout.hidden.includes(id));
    return { ...layout, order: placedIds(layout, builtins, widgets), hidden: [...layout.hidden, ...stillOff] };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function resolveHomeHubLayout<W extends HomeHubWidgetInput>(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly W[],
): ResolvedHomeHubLayout<W> {
    const builtinById = new Map(builtins.map((section) => [section.id, section]));
    const hidden = new Set(layout.hidden);
    const widgetById = new Map(widgets.map((widget) => [homeHubWidgetSectionId(widget.key), widget]));
    const sections: HomeHubSection<W>[] = [];
    const onHome = new Set<string>();
    for (const id of placedIds(layout, builtins, widgets)) {
        const frameStyle = layout.sections?.[id]?.frameStyle;
        const frame = frameStyle ? { frameStyle } : {};
        const builtin = builtinById.get(id);
        if (builtin) {
            sections.push({ kind: 'builtin', id: builtin.id, hidden: isBuiltinHidden(layout, hidden, builtin), hideable: builtin.hideable, ...frame });
            continue;
        }
        const widget = widgetById.get(id);
        if (!widget || hidden.has(id)) continue;
        sections.push({ kind: 'widget', id, widget, hidden: false, hideable: true, ...frame });
        onHome.add(id);
    }
    return {
        sections,
        available: widgets.filter((widget) => !onHome.has(homeHubWidgetSectionId(widget.key))),
    };
}

/** Swap a section with its neighbour in the list the person sees; unknown ids stay where they are. */
export function moveHomeHubSection(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
    id: string,
    step: -1 | 1,
): HomeHubLayoutValue {
    const visible = resolveHomeHubLayout(layout, builtins, widgets).sections.map((section) => section.id);
    const from = visible.indexOf(id);
    const neighbour = visible[from + step];
    if (from < 0 || neighbour === undefined) return layout;
    const next = [...visible];
    next[from] = neighbour;
    next[from + step] = id;
    return reorderHomeHubSections(layout, builtins, widgets, next);
}

/**
 * Put the sections the person sees (Customize's list) in a new order — a drag, or a keyboard move.
 * The listed ids take the slots they held among the placed ids, so ids this version does not know,
 * and widgets not on Home, keep their exact place. An order that changes nothing writes nothing.
 */
export function reorderHomeHubSections(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
    orderedIds: readonly string[],
): HomeHubLayoutValue {
    const visible = resolveHomeHubLayout(layout, builtins, widgets).sections.map((section) => section.id);
    const listed = orderedIds.filter((id, index) => visible.includes(id) && orderedIds.indexOf(id) === index);
    if (listed.length !== visible.length || sameIds(listed, visible)) return layout;
    const base = materialize(layout, builtins, widgets);
    const slots = new Set(visible);
    let next = 0;
    const order = base.order.map((id) => (slots.has(id) ? listed[next++]! : id));
    return { ...base, order };
}

/**
 * Show or hide a section. For a widget, hiding removes it from Home (it returns to Add widgets and
 * never comes back unasked) and showing adds it, after the sections already on Home.
 */
export function setHomeHubSectionHidden(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
    id: string,
    hide: boolean,
): HomeHubLayoutValue {
    const builtin = builtins.find((section) => section.id === id);
    if (builtin && !builtin.hideable) return layout;
    const current = resolveHomeHubLayout(layout, builtins, widgets).sections.find((section) => section.id === id);
    if (builtin) {
        if (current?.hidden === hide) return layout;
        const base = materialize(layout, builtins, widgets);
        return {
            ...base,
            order: base.order,
            hidden: hide ? [...base.hidden, id] : base.hidden.filter((candidate) => candidate !== id),
        };
    }
    if (!widgets.some((widget) => homeHubWidgetSectionId(widget.key) === id)) return layout;
    const isHidden = layout.hidden.includes(id);
    const onHome = current !== undefined;
    if (hide) {
        return isHidden ? layout : { ...layout, hidden: [...layout.hidden, id] };
    }
    if (onHome) return layout;
    const base = materialize(layout, builtins, widgets);
    return {
        ...base,
        order: base.order.includes(id) ? base.order : [...base.order, id],
        hidden: base.hidden.filter((candidate) => candidate !== id),
    };
}

/** The "Get set up" steps the person dismissed (Customize → Hidden setup steps). */
export function listHiddenHomeSetupSteps(layout: HomeHubLayoutValue): string[] {
    return layout.hidden
        .filter((id) => id.startsWith(SETUP_STEP_ID_PREFIX))
        .map((id) => id.slice(SETUP_STEP_ID_PREFIX.length));
}

/** Dismiss a "Get set up" step, or bring it back. Sections and their order are untouched. */
export function setHomeSetupStepHidden(layout: HomeHubLayoutValue, stepId: string, hide: boolean): HomeHubLayoutValue {
    const id = `${SETUP_STEP_ID_PREFIX}${stepId}`;
    const isHidden = layout.hidden.includes(id);
    if (hide === isHidden) return layout;
    return {
        ...layout,
        order: [...layout.order],
        hidden: hide ? [...layout.hidden, id] : layout.hidden.filter((candidate) => candidate !== id),
    };
}

/** "Show again": every dismissed setup step returns. */
export function showAllHomeSetupSteps(layout: HomeHubLayoutValue): HomeHubLayoutValue {
    if (!layout.hidden.some((id) => id.startsWith(SETUP_STEP_ID_PREFIX))) return layout;
    return { ...layout, hidden: layout.hidden.filter((id) => !id.startsWith(SETUP_STEP_ID_PREFIX)) };
}

/** Customize and Action invocations share these same section/widget decisions. */
export function applyHomeHubLayoutIntent(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
    intent: HomeHubLayoutIntent,
): HomeHubLayoutValue {
    switch (intent.kind) {
        case 'move': return moveHomeHubSection(layout, builtins, widgets, intent.sectionId, intent.step);
        case 'reorder': return reorderHomeHubSections(layout, builtins, widgets, intent.sectionIds);
        case 'visibility': return setHomeHubSectionHidden(layout, builtins, widgets, intent.sectionId, intent.hidden);
        case 'frameStyle': return setHomeHubSectionFrameStyle(layout, builtins, widgets, intent.sectionId, intent.frameStyle);
        case 'setup_visibility': return setHomeSetupStepHidden(layout, intent.stepId, intent.hidden);
        case 'restore_setup': return showAllHomeSetupSteps(layout);
        case 'reset': return layout.order.length === 0 && layout.hidden.length === 0 && !layout.sections ? layout : HOME_HUB_DEFAULT_LAYOUT;
    }
}

export function setHomeHubSectionFrameStyle(
    layout: HomeHubLayoutValue,
    builtins: readonly HomeHubBuiltinDefinition[],
    widgets: readonly HomeHubWidgetInput[],
    id: string,
    frameStyle: 'card' | 'plain' | null,
): HomeHubLayoutValue {
    if (!builtins.some((section) => section.id === id) && !widgets.some((widget) => homeHubWidgetSectionId(widget.key) === id)) return layout;
    if (layout.sections?.[id]?.frameStyle === (frameStyle ?? undefined)) return layout;
    const sections = { ...layout.sections };
    if (frameStyle === null) delete sections[id];
    else sections[id] = { frameStyle };
    const { sections: _previous, ...base } = layout;
    return Object.keys(sections).length ? { ...base, sections } : base;
}
