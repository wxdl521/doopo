export type RestyleStage = "upload" | "analysis" | "assets" | "plan" | "render" | "review";

export type RestyleAsset = {
  id: string;
  name: string;
  kind: "character" | "scene" | "prop";
  role: string;
  detail: string;
  color: string;
  imageUrl?: string;
};
