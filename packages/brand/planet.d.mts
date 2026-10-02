export type PlanetTheme = 'dark' | 'light';
export type PlanetRgb = readonly [number, number, number];
export type PlanetCell = Readonly<{ ch: string; rgb: PlanetRgb }>;
export type PlanetFrame = readonly (readonly (PlanetCell | null)[])[];
export type PlanetFrameOptions = Readonly<{ columns?: number; seconds?: number; theme?: PlanetTheme; intro?: boolean; dim?: number }>;
type PlanetHorizon = Readonly<{
  skyGradient: string; backgroundColor: string; backgroundColorTransparent: string;
  atmosphereColor: string; bloomColor: string; dividerColor: string;
}>;
type PlanetPalette = Readonly<{
  background: PlanetRgb; body: readonly (readonly [number, PlanetRgb])[];
  rose: PlanetRgb; rim: PlanetRgb; halo: readonly (readonly [number, PlanetRgb])[];
  horizon: PlanetHorizon; websiteScrim: string; voiceField: string;
}>;
type Orb = Readonly<{ core: string; gold: string; amber: string; ember: string; plum: string; azure: string }>;
export const PLANET_PALETTES: Readonly<{
  dark: PlanetPalette & { readonly orb: Orb & { readonly abyss: string } };
  light: PlanetPalette & { readonly orb: Orb & { readonly violet: string; readonly veil: string } };
}>;
export const PLANET_LIGHT_RAMP: Readonly<{ warm: string; blush: string; violet: string; cool: string; deep: string }>;
export const PLANET_ARTWORK_BREATH: Readonly<{ durationMs: 20000; scalePeak: 1.012; bloomOpacityDelta: 0.1 }>;
export const PLANET_GRAIN: Readonly<{ opacity: 0.02; tileSize: 16 }>;
export const PLANET_ACCENT_HEX: string;
export const PLANET_BREATH_SECONDS: number;
export const PLANET_FRAME_INTERVAL_MS: number;
export const PLANET_BREATH_FRAME_INTERVAL_MS: number;
export function planetFrameIntervalMs(seconds: number): number;
export function planetRowsForColumns(columns?: number): number;
export function createPlanetFrame(options?: PlanetFrameOptions): PlanetFrame;
