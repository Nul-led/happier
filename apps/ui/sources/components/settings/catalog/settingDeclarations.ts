import { Platform } from 'react-native';
import type { FeatureId } from '@happier-dev/protocol';

import type { TranslationKeyNoParams } from '@/text';
import { desktopHostKind, isDesktopHost } from '@/utils/platform/desktopHost';

import type { SettingsPageId } from './types';

/**
 * Settings declared by a page so search can find them individually.
 *
 * A page declares each setting once — its id and the translation keys of its label — and renders its
 * row from that declaration (`SettingRow`). The label on screen and the label search matches are
 * therefore the same value by construction, and every declared setting has a stable anchor
 * (`<pageId>.<settingId>`, or `<pageId>.<subpageId>.<settingId>` on a sub-page) that search can
 * navigate to.
 *
 * What a declaration can say about when its row exists:
 * - `host`: the row exists only on some hosts (a platform or the desktop app). Static for the life of
 *   the app, so search never offers the row elsewhere, and the page renders it under the same
 *   predicate (`settingRendersOnHost`).
 * - `featureId` (sections): the section renders only while that feature is on; search follows.
 * - Anything else (another setting's value, a selected machine, a feature being off) is page state.
 *   Search still offers the row; when the page opens without it, the enclosing `SettingSection`
 *   reveals the section instead, whose own state line says what the row needs.
 * A row that no page state can ever render is not declared.
 */

/** The host the app runs on, as far as settings rows care. */
export type SettingsHost = Readonly<{
    os: typeof Platform.OS;
    /** A desktop shell (Tauri or Electron); its web view reports `os: 'web'`. */
    desktop: boolean;
}>;

/** Whether a row can exist on this host at all. */
export type SettingsHostPredicate = (host: SettingsHost) => boolean;

/** The host predicates rows use; name new ones here rather than inlining them in declarations. */
export const settingsHosts = {
    ios: (host) => host.os === 'ios',
    native: (host) => host.os === 'ios' || host.os === 'android',
    web: (host) => host.os === 'web',
    notWeb: (host) => host.os !== 'web',
    desktop: (host) => host.desktop,
    /** The Tauri shell in particular (asked of the desktop host only when a row needs it). */
    tauriDesktop: (host) => host.desktop && desktopHostKind() === 'tauri',
    iosOrDesktop: (host) => host.os === 'ios' || host.desktop,
} satisfies Readonly<Record<string, SettingsHostPredicate>>;

export function resolveSettingsHost(): SettingsHost {
    return { os: Platform.OS, desktop: isDesktopHost() };
}

export type SettingDeclaration = Readonly<{
    titleKey: TranslationKeyNoParams;
    descriptionKey?: TranslationKeyNoParams;
    /** Extra searchable words, as translation keys so they are found in every language. */
    keywordKeys?: readonly TranslationKeyNoParams[];
    /** The row exists only on these hosts. */
    host?: SettingsHostPredicate;
}>;

export type SettingsSectionDeclaration = Readonly<{
    titleKey?: TranslationKeyNoParams;
    /** The section renders only while this feature is on; search offers its settings under the same condition. */
    featureId?: FeatureId;
    /** The section exists only on these hosts. */
    host?: SettingsHostPredicate;
    settings: Readonly<Record<string, SettingDeclaration>>;
}>;

export type SettingRef = Omit<SettingDeclaration, 'host'> & Readonly<{
    /** `<pageId>.<settingId>`: the row anchor and the search result identity. */
    anchor: string;
    /** The enclosing section's id (`SettingsSectionRef.id`), revealed when the row is not rendered. */
    sectionId: string;
    sectionTitleKey?: TranslationKeyNoParams;
    featureId?: FeatureId;
    /** The section's and the row's host predicates together. */
    host?: SettingsHostPredicate;
}>;

/** A declared section, for `SettingSection`: the rows it holds and the id its reveal answers to. */
export type SettingsSectionRef = Readonly<{
    /** `<pageId>.<sectionId>` (with the sub-page id on a sub-page). Never a URL anchor. */
    id: string;
    settingAnchors: readonly string[];
}>;

type SettingIds<Sections extends Record<string, SettingsSectionDeclaration>> = {
    [Section in keyof Sections]: keyof Sections[Section]['settings'] & string;
}[keyof Sections];

/** The selected Settings leaf's explicit route inputs; this is not an entity inventory. */
export type SettingsRouteContext = Readonly<{
    pathname: string;
    params: Readonly<Record<string, string | string[] | undefined>>;
}>;

/** Scoped destinations consume explicit identity, never a focused Home; null omits an unbound row. */
export type SettingsSubpageRoute = string | ((context: SettingsRouteContext) => string | null);

/**
 * A page reached from a catalog page (a link row) rather than from the rail. Its settings belong to
 * the catalog page (visibility, search result identity) but live on the sub-page's own route.
 */
export type SettingsSubpageDeclaration = Readonly<{
    /** Joins the anchor: `<pageId>.<subpageId>.<settingId>`. */
    id: string;
    route: SettingsSubpageRoute;
    titleKey: TranslationKeyNoParams;
}>;

export type SettingsPageDeclaration<Sections extends Record<string, SettingsSectionDeclaration> = Record<string, SettingsSectionDeclaration>> = Readonly<{
    pageId: SettingsPageId;
    subpage?: SettingsSubpageDeclaration;
    sections: Sections;
    /** Every declared section, keyed by its id, ready to hand to `SettingSection`. */
    sectionRefs: Readonly<Record<keyof Sections & string, SettingsSectionRef>>;
    /** Every declared setting, keyed by its id, ready to hand to `SettingRow`. */
    settings: Readonly<Record<SettingIds<Sections>, SettingRef>>;
}>;

function combineHostPredicates(
    section: SettingsHostPredicate | undefined,
    setting: SettingsHostPredicate | undefined,
): SettingsHostPredicate | undefined {
    if (!section) return setting;
    if (!setting) return section;
    return (host) => section(host) && setting(host);
}

export function defineSettingsPage<const Sections extends Record<string, SettingsSectionDeclaration>>(input: Readonly<{
    pageId: SettingsPageId;
    subpage?: SettingsSubpageDeclaration;
    sections: Sections;
}>): SettingsPageDeclaration<Sections> {
    const settings: Record<string, SettingRef> = {};
    const sectionRefs: Record<string, SettingsSectionRef> = {};
    const anchorPrefix = input.subpage ? `${input.pageId}.${input.subpage.id}` : input.pageId;
    for (const [sectionKey, section] of Object.entries(input.sections)) {
        const sectionId = `${anchorPrefix}.${sectionKey}`;
        const settingAnchors: string[] = [];
        for (const [settingId, declaration] of Object.entries(section.settings)) {
            if (settings[settingId]) {
                throw new Error(`Duplicate setting id "${settingId}" on settings page "${input.pageId}"`);
            }
            const { host, ...label } = declaration;
            const combinedHost = combineHostPredicates(section.host, host);
            const anchor = `${anchorPrefix}.${settingId}`;
            settingAnchors.push(anchor);
            settings[settingId] = {
                ...label,
                anchor,
                sectionId,
                sectionTitleKey: section.titleKey,
                ...(section.featureId ? { featureId: section.featureId } : {}),
                ...(combinedHost ? { host: combinedHost } : {}),
            };
        }
        sectionRefs[sectionKey] = { id: sectionId, settingAnchors };
    }
    return {
        pageId: input.pageId,
        subpage: input.subpage,
        sections: input.sections,
        sectionRefs: sectionRefs as SettingsPageDeclaration<Sections>['sectionRefs'],
        settings: settings as SettingsPageDeclaration<Sections>['settings'],
    };
}

/** Whether a declared row exists on this host. Pages render host-bound rows under this, as search offers them. */
export function settingRendersOnHost(ref: Pick<SettingRef, 'host'>, host: SettingsHost = resolveSettingsHost()): boolean {
    return ref.host ? ref.host(host) : true;
}

/** Every feature a declared section is gated on: the catalog evaluates exactly these. */
export function collectDeclaredFeatureIds(declarations: readonly SettingsPageDeclaration[]): FeatureId[] {
    const ids = new Set<FeatureId>();
    for (const declaration of declarations) {
        for (const section of Object.values(declaration.sections)) {
            if (section.featureId) ids.add(section.featureId);
        }
    }
    return [...ids];
}

/** The route query parameter that names the setting a page should reveal. */
export const SETTING_ANCHOR_QUERY_PARAM = 'setting';

/** The link that opens a settings page and reveals one declared setting on it. */
export function buildSettingHref(route: string, ref: Pick<SettingRef, 'anchor'>): string;
export function buildSettingHref(route: SettingsSubpageRoute, ref: Pick<SettingRef, 'anchor'>, context?: SettingsRouteContext): string | null;
export function buildSettingHref(route: SettingsSubpageRoute, ref: Pick<SettingRef, 'anchor'>, context?: SettingsRouteContext): string | null {
    const destination = typeof route === 'string' ? route : context ? route(context) : null;
    if (destination === null) return null;
    const separator = destination.includes('?') ? '&' : '?';
    return `${destination}${separator}${SETTING_ANCHOR_QUERY_PARAM}=${encodeURIComponent(ref.anchor)}`;
}
