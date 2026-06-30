// Reflects the optional Next.js `basePath` (set via NEXT_PUBLIC_BASE_PATH at
// build time). Empty string when unset, so the public hosted app is unaffected.
// Use this to prefix literal client-side fetch() calls to the app's own API
// routes — Next auto-prefixes <Link>/router/_next assets, but NOT raw fetch
// strings, when the app is deployed under a sub-path (e.g. behind a reverse
// proxy at /humanizer/).
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH || "";
