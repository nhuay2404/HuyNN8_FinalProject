import type { Metadata } from "next";
import GamePrototype from "./GamePrototype";

export const metadata: Metadata = {
  title: "3D Cannon Sort — Weak Point & Rainbow Climax",
  description: "Rotate, hit cluster Weak Points, catch Rainbow Targets and sort fast during Climax.",
};

export default function Home() {
  return <GamePrototype />;
}
