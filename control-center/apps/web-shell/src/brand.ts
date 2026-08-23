/**
 * Official CONFENGE mark carried by the shell.
 *
 * Only the white version is legible on the dark topbar. The file under
 * `public/` is a byte-for-byte copy of the brand asset: it is never recoloured,
 * re-encoded, or replaced by improvised type. Vite copies `public/` verbatim
 * into `dist/`, so the runtime path is the file name at the site root, and the
 * production CSP (`img-src 'self' data:`) admits that same-origin file but no
 * CDN.
 */
export const BRAND_LOGO_FILE = "logo-confenge-white.png";

/** Document-relative: the shell is hash-routed, so the path is always `/`. */
export const BRAND_LOGO_SRC = `./${BRAND_LOGO_FILE}`;

/** Intrinsic size of the asset. Emitted so the header reserves the right box
 *  and so any accidental re-encode at another size fails the brand test. */
export const BRAND_LOGO_WIDTH = 800;
export const BRAND_LOGO_HEIGHT = 208;
