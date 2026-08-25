import type { Metadata } from "next";
import SandGame from "./SandGame";

export const metadata: Metadata = {
  title: "3D Sand Cannon Sort",
  description: "Aim a disc into a pixel sand painting, sort out the colour in hand, and clear the frame before the shots run out.",
};

export default function Home() {
  return <SandGame />;
}
