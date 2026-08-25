import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { LOADING_SCREEN_MARKUP } from "./loading-screen";

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
    <html lang="en">
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
