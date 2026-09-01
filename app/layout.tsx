import type { Metadata } from "next";
import { headers } from "next/headers";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";
import { LOADING_SCREEN_MARKUP } from "./loading-screen";

/*
 * Two rounded faces instead of one display face at a single weight.
 *
 * The game used to ship one self-hosted TTF ("Super Pandora") that only had a
 * 400, so every `font-weight: 700/800/900` in globals.css was the browser
 * synthesising a bold — which smears at the small sizes most of this HUD uses.
 * Baloo 2 carries real 400–800, and its chunky rounded terminals are the whole
 * reason a cozy game menu reads as friendly rather than as an app's settings
 * screen.
 *
 * Nunito handles anything under ~13px (shop blurbs, tutorial steps, micro
 * labels): Baloo 2 is drawn tight and its counters close up at that size.
 *
 * `next/font/google` is not a runtime dependency on fonts.googleapis.com —
 * vinext's own fonts plugin downloads the .woff2 files at build time into
 * `.vinext/fonts/` and rewrites the @font-face `src` to this app's own origin
 * (see node_modules/vinext/dist/plugins/fonts.js). The game stays as offline
 * as it was with the bundled TTF; the network is only touched once, while
 * building. The `vietnamese` subset is included on both because that is the
 * one localisation this game is actually likely to get.
 */
const display = Baloo_2({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Nunito({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  const title = "3D Sand Cannon Sort";
  const description = "Aim a disc into a pixel sand painting, sort out the colour in hand, and clear the frame before the shots run out.";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1731, height: 909, alt: "3D Sand Cannon Sort" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /* The font variables go on <html>, not <body>, because the loading screen
       below is server-rendered outside the React root and paints before any
       bundle runs — it has to be able to read --font-display from the very
       first frame, same as the rest of the page. */
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {children}
        {/* Server-rendered, so it is in the HTML the browser paints first —
            which is the whole reason it exists. It sits outside the React root
            and is removed by hand once the engine has drawn a frame; nothing
            re-renders this subtree, so React never puts it back. */}
        <div dangerouslySetInnerHTML={{ __html: LOADING_SCREEN_MARKUP }} />
      </body>
    </html>
  );
}
