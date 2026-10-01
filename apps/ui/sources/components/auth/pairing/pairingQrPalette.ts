/**
 * The pairing QR's own palette. A camera reads a QR code as dark modules on a light field, so the
 * code, its paper and the Happier mark in its centre stay the same in light and dark themes (the
 * QR renderer's defaults are black on white). Theme tokens cannot express "white in
 * every theme", so this bounded surface names its two inks here and nowhere else.
 */
export const PAIRING_QR_PALETTE = Object.freeze({
    /** The QR renderer draws black modules on white by default; the paper around it matches. */
    paper: '#FFFFFF',
    /** The paper's edge and lift: a hairline and a soft drop, enough to separate white from a white page. */
    edge: 'rgba(0, 0, 0, 0.08)',
    shadow: 'rgba(0, 0, 0, 0.10)',
});
