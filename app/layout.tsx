import type { Metadata } from "next";
import "./globals.css";
import { LOADING_SCREEN_MARKUP } from "./loading-screen";

export const metadata: Metadata = {
  title: "3D Cannon Sort",
  description: "Aim, shoot and sort colour blocks in 3D space.",
};

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
