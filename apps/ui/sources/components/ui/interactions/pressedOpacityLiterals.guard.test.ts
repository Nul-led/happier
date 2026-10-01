import { describe, expect, it } from 'vitest';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Press feedback has one owner: `usePressFeedback` (tactile scale, reduced-motion
 * opacity) reading `motionTokens.press`. A literal pressed opacity or a static
 * pressed scale anywhere else is a second, drifting copy of that decision.
 */
const SOURCES_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OWNER_DIRS = ['components/ui/interactions/', 'components/ui/motion/'];
/** Being edited by a live session; migrated when it lands (tracked in the lane report). */
const LIVE_FILES = new Set(['components/sessions/shell/SessionView.tsx']);
const EXCLUDED_DIR_NAMES = new Set(['__tests__', '__testdata__', 'node_modules']);
const EXCLUDED_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

/**
 * A literal pressed opacity in any inline shape: `pressed ? 0.7`, `pressed || busy ? 0.78`,
 * `pressed && !disabled ? { opacity: 0.72 }`, `pressed ? { opacity: 0.7 } : null`,
 * `pressed && { opacity: 0.8 }` (also `state.pressed`). The optional `&&`/`||` condition may not
 * cross a ternary branch (`:`) or a statement/argument boundary.
 */
const PRESSED_OPACITY_LITERAL =
    /\bpressed\s*(?:(?:\|\||&&)\s*[^?:;,\n]*?)?(?:\?|&&)\s*(?:0?\.\d|\{[^}]*\bopacity\s*:\s*0?\.\d)/g;
/**
 * A pressed style key body (one level of nested braces, e.g. `transform: [{ scale }]`): both a bare
 * `pressed:` key and any `*Pressed:` key (`rowPressed`, `buttonPressed`).
 */
const PRESSED_STYLE_KEY = /\b\w*[Pp]ressed\s*:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;

function findPressFeedbackViolations(path: string, source: string): string[] {
    const violations: string[] = [];
    for (const match of source.matchAll(PRESSED_OPACITY_LITERAL)) {
        violations.push(`${path}:${lineOf(source, match.index)} literal pressed opacity; use motionTokens.press`);
    }
    for (const match of source.matchAll(PRESSED_STYLE_KEY)) {
        const body = match[1] ?? '';
        if (/\bscale\b/.test(body)) {
            violations.push(`${path}:${lineOf(source, match.index)} static pressed scale; use usePressFeedback`);
        }
        if (/\bopacity\s*:\s*0?\.\d/.test(body)) {
            violations.push(`${path}:${lineOf(source, match.index)} literal pressed opacity; use motionTokens.press`);
        }
    }
    return violations;
}

function listSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            if (!EXCLUDED_DIR_NAMES.has(entry)) files.push(...listSourceFiles(fullPath));
            continue;
        }
        if (!/\.tsx?$/.test(entry) || EXCLUDED_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
        files.push(fullPath);
    }
    return files;
}

function lineOf(source: string, index: number): number {
    return source.slice(0, index).split('\n').length;
}

describe('pressed feedback literals', () => {
    it.each([
        ['bare ternary', 'style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}'],
        ['or-condition ternary', 'opacity: pressed || busy ? 0.78 : 1'],
        ['and-condition object ternary', 'style={({ pressed }) => [s.a, pressed && !disabled ? { opacity: 0.72 } : null]}'],
        ['and-condition identifier ternary', 'pressed && canGoNext ? { opacity: 0.85 } : null'],
        ['inline object ternary', 'state.pressed ? { opacity: 0.7 } : null'],
        ['inline and-object', 'pressed && { opacity: 0.8 }'],
        ['bare pressed style key', 'const styles = { pressed: {\n        opacity: 0.92,\n    } };'],
        ['camel pressed style key', 'rowPressed: { opacity: 0.6 },'],
        ['pressed style key with scale', 'buttonPressed: { transform: [{ scale: 0.96 }] },'],
    ])('flags %s', (_label, source) => {
        expect(findPressFeedbackViolations('fixture.tsx', source)).toHaveLength(1);
    });

    it.each([
        ['token ternary', 'opacity: pressed ? motionTokens.press.opacity : 1'],
        ['token and-condition ternary', 'pressed && !disabled ? { opacity: motionTokens.press.opacitySubtle } : null'],
        ['style reference', 'pressed && !disabled ? styles.pressed : null'],
        ['literal only in the other branch', 'pressed && selected ? styles.active : { opacity: 0.5 }'],
        ['disabled literal outside the pressed decision', 'disabled ? 0.45 : pressed ? motionTokens.press.opacity : 1'],
        ['background-only pressed key', 'pressed: { backgroundColor: theme.colors.surface.pressed },'],
        ['pressedOverlay token key', 'pressedOverlay: { opacity: 0.5 },'],
        ['token pressed key', 'pressed: { opacity: motionTokens.press.opacity },'],
    ])('allows %s', (_label, source) => {
        expect(findPressFeedbackViolations('fixture.tsx', source)).toEqual([]);
    });

    it('keeps pressed opacity and pressed scale on the shared press owner', () => {
        const violations: string[] = [];
        for (const file of listSourceFiles(SOURCES_ROOT)) {
            const path = relative(SOURCES_ROOT, file).split(sep).join('/');
            if (LIVE_FILES.has(path) || OWNER_DIRS.some((dir) => path.startsWith(dir))) continue;
            violations.push(...findPressFeedbackViolations(path, readFileSync(file, 'utf8')));
        }
        expect(violations).toEqual([]);
    });
});
