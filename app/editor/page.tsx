import type { Metadata } from "next";
import LevelEditor from "../LevelEditor";

export const metadata: Metadata = {
  title: "Sand level editor",
  description: "Draw a pixel sand picture, set its ammo wheel and shot budget, and test it in the game.",
};

export default function EditorPage() {
  return <LevelEditor />;
}
