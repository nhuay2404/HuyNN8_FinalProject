// Resolves a `public/`-relative asset path for whichever build is running.
//
// The normal dev/production site serves `public/` over HTTP, so a path like
// `/shop/coins099.png` is already the right answer and this is a no-op. The
// standalone single-file build has no server: `build-standalone.mjs` inlines
// every asset as a base64 `data:` URI instead, by string-replacing the path
// literals it finds in the bundled JS.
//
// That literal replacement is why this module exists. It can only match a
// path that appears in the source *as a whole string*, and the Shop's
// illustrations do not — they are assembled at runtime out of a pack's own
// price (`` `/shop/coins${price}.png` ``, see `coinPackIllustrationSrc` and
// friends in `SandGame.tsx`). The bundle contains `"/shop/coins"` and an
// expression, never `"/shop/coins099.png"`, so the replacement pass has
// nothing to hit and the standalone build rendered the whole Shop with broken
// images. Routing those four helpers through here gives the build a lookup it
// can seed with the finished paths instead.
let embeddedAssets: Readonly<Record<string, string>> | null = null;

/**
 * Called once by `standalone-entry.tsx` before anything renders, with the
 * path→`data:` URI map `build-standalone.mjs` baked into the bundle. Nothing
 * calls this on the real site, which is exactly why `resolvePublicAssetUrl`
 * below falls through to the path unchanged there.
 */
export function seedEmbeddedPublicAssets(assets: Record<string, string>) {
  embeddedAssets = assets;
}

/**
 * The inlined `data:` URI for `path` when running inside the standalone
 * build, or `path` itself everywhere else. An unknown path also falls
 * through unchanged: a missing entry means "this build serves it normally",
 * not an error worth breaking a render over.
 */
export function resolvePublicAssetUrl(path: string): string {
  return embeddedAssets?.[path] ?? path;
}
