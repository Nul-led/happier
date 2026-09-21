import { ICON_REGISTRY, type IconName } from './iconRegistry.generated';

/**
 * Narrow a free-form string to a glyph this app actually ships.
 *
 * Icon names arrive from outside the compiler all the time — provider icon
 * hints published by a Home, plugin-contributed tokens, persisted values. The
 * generated registry is the allowlist that answers whether one of them is real,
 * so asking it once here is what lets those call sites pass a name without an
 * `as` cast and without a second hand-written list of glyph names beside it.
 *
 * It lives beside {@link Icon} rather than inside it because the icon component
 * pulls in the native drawing primitives and is mocked wholesale under test,
 * while this question is a pure lookup every consumer — production or test —
 * must get the same answer to.
 */
export function asIconName(value: string | null | undefined): IconName | undefined {
    return typeof value === 'string' && Object.hasOwn(ICON_REGISTRY, value)
        ? value as IconName
        : undefined;
}
