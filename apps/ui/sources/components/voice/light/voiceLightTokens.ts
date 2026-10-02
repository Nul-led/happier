import { useUnistyles } from 'react-native-unistyles';
import { PLANET_PALETTES, PLANET_LIGHT_RAMP, PLANET_GRAIN, PLANET_ARTWORK_BREATH } from '@happier-dev/brand/planet';

/** Palette and existing artwork motion are projections of the shared brand owner.
 * Keep these exports for the current voice components; the lab redesign is separate.
 */
export const PLANET_DARK = PLANET_PALETTES.dark.orb;
export const PLANET_LIGHT = PLANET_PALETTES.light.orb;
export const VOICE_LIGHT = PLANET_LIGHT_RAMP;
export type VoiceLightStop = keyof typeof VOICE_LIGHT;
export const VOICE_GRAIN = PLANET_GRAIN;
export const VOICE_BREATH = PLANET_ARTWORK_BREATH;

/**
 * Motion tokens for the lab. Durations are deliberately short for repeated
 * actions and longer only for the one signature transition (collapse ⇄ expand).
 * Easings are expressed as cubic-bezier control points so both the Reanimated
 * `Easing.bezier(...)` and the web CSS forms stay in lockstep.
 */
export const VOICE_MOTION = {
    /** Press feedback and other level-1 state feedback. */
    feedback: { durationMs: 120, bezier: [0.2, 0, 0, 1] },
    /** Local continuity: status swaps, control appear/disappear. */
    local: { durationMs: 220, bezier: [0.2, 0, 0, 1] },
    /**
     * Spatial transition: the collapse ⇄ expand of the presence itself.
     *
     * 420ms on an expo-out curve read as a snap — the object arrived before the
     * eye could follow it, which is the "jiggly" quality. The presence is a
     * *breathing body*, so its own transitions should move like one: slower, and
     * on a curve that eases at BOTH ends rather than firing hard and braking.
     * This is a single signature transition, not a repeated utility action, so
     * it can afford the extra 200ms.
     */
    spatial: { durationMs: 620, bezier: [0.32, 0.06, 0.2, 1] },
    /** Exits are quieter and faster than entrances. */
    exit: { durationMs: 180, bezier: [0.4, 0, 1, 1] },
    /** Stagger between semantic chunks in a staged reveal. */
    staggerMs: 46,
    /**
     * Where a thrown object comes to rest.
     *
     * **Critically damped — it settles, it does not bounce.** `dampingRatio: 1`
     * is the no-overshoot boundary: the orb decelerates into its corner and
     * stops, rather than arriving, passing the target, and springing back. A
     * bounce here reads as a toy; the presence should feel like a heavy, calm
     * object coming to rest.
     *
     * These are Apple's own values for *repositioning a floating companion*
     * (the PiP window): damping 1.0, response 0.4. Bounce is reserved for
     * moments where overshoot expresses something — and "I put this down where
     * I wanted it" is not one of them.
     *
     * The release velocity is still handed to the spring (see `SETTLE_SPRING`
     * in the orb): removing bounce must not remove *continuity*. The motion
     * begins at exactly the speed the finger left, then decays — no seam
     * between dragging and animating.
     */
    settle: { durationMs: 400, dampingRatio: 1 },
    /**
     * Momentum projection — where a flick is *aiming*, not where the finger let go.
     *
     * Apple's exponential-decay projection from *Designing Fluid Interfaces*:
     *
     *   projected = current + (velocity / 1000) · d / (1 − d)
     *
     * With `d = 0.998` the coefficient is ≈ 0.499 s. The lab previously used a
     * flat `0.12`, which is roughly four times too weak — every flick fell short
     * of where it was thrown, so the orb felt heavier than the gesture implied.
     */
    throwProjectionSeconds: 0.499,
} as const;

export type VoiceLightTokens = Readonly<{
    /** True when the app theme is dark. */
    dark: boolean;
    /** The canvas the presence sits on (matches the host surface). */
    canvas: string;
    /** The atmospheric field behind the light, at rest. */
    field: string;
    /**
     * The host surface the presence sits on (`theme.colors.surface.base`), and
     * its fully transparent twin.
     *
     * These are **baked literals, not derived at runtime**. Unistyles compiles
     * theme tokens to CSS variables on web, so `${theme.colors.surface.base}00`
     * would produce `var(--x)00` — a silently invalid colour. Any fade that
     * needs a transparent version of a token must carry it as its own literal.
     */
    hostSurface: string;
    hostSurfaceTransparent: string;
    /** Hairline that defines a boundary without becoming a card border. */
    rule: string;
    /** Primary type on the presence. */
    ink: string;
    /** Secondary type: status, provenance. */
    inkMuted: string;
    /** Tertiary type: timestamps, counts. */
    inkFaint: string;
    /** Ink that reads over the brightest part of the light. */
    inkOnLight: string;
    /** Multiplier applied to every glow alpha — light needs more presence on dark. */
    glowGain: number;
    /** Blend mode for additive light layers where the platform supports it. */
    lightBlend: 'screen' | 'plus-lighter' | undefined;
}>;

const DARK: VoiceLightTokens = {
    dark: true,
    canvas: '#131111',
    field: PLANET_PALETTES.dark.voiceField,
    hostSurface: '#191717',
    hostSurfaceTransparent: 'rgba(25,23,23,0)',
    rule: 'rgba(255,255,255,0.07)',
    ink: '#EFEFEF',
    inkMuted: '#8A817C',
    inkFaint: '#6C625D',
    inkOnLight: '#0B0A12',
    glowGain: 1,
    lightBlend: 'screen',
};

const LIGHT: VoiceLightTokens = {
    dark: false,
    canvas: '#FBFAF9',
    field: PLANET_PALETTES.light.voiceField,
    hostSurface: '#ffffff',
    hostSurfaceTransparent: 'rgba(255,255,255,0)',
    rule: 'rgba(0,0,0,0.06)',
    ink: '#0A0A0A',
    inkMuted: '#6c6c70',
    inkFaint: '#99999d',
    inkOnLight: '#1A1020',
    // Light canvases swallow additive glow, so the same alpha reads weaker.
    glowGain: 0.72,
    lightBlend: undefined,
};

export function useVoiceLightTokens(): VoiceLightTokens {
    const { theme } = useUnistyles();
    return theme.dark ? DARK : LIGHT;
}

/**
 * Ink for marks drawn ON the planet's body (the meter inside the orb).
 *
 * White works on the dark planet and disappears on the light one, whose crown is
 * pale gold — so this flips rather than being a constant.
 */
export function onPlanetInk(_tokens: VoiceLightTokens): string {
    // White in both themes. The meter sits ON the body, not on the canvas, and
    // the body is saturated enough at every stop that a dark ink reads as dirt.
    return 'rgba(255,253,250,0.96)';
}

/** `rgba()` string for a light stop at a given alpha, pre-multiplied by the theme's glow gain. */
export function light(stop: VoiceLightStop, alpha: number, tokens: VoiceLightTokens): string {
    const hex = VOICE_LIGHT[stop];
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const a = Math.max(0, Math.min(1, alpha * tokens.glowGain));
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
