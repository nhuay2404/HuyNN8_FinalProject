import type { Metadata } from "next";
import GamePrototype from "./GamePrototype";

export const metadata: Metadata = {
  title: "3D Cannon Sort — Prototype",
  description: "Rotate the model, line up the crosshair and break the right colour cluster.",
};

export default function Home() {
  return <GamePrototype />;
}
