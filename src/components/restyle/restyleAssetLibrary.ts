import type { DbCharacter, DbProp, DbScene } from "../../lib/assetsStorage";
import type { RestyleAsset } from "./restyleTypes";

function findAssetImage(images: unknown, coverUrl: string | null): string | undefined {
  if (coverUrl) return coverUrl;
  if (!Array.isArray(images)) return undefined;
  const first = images.find(
    (item): item is { url: string } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { url?: unknown }).url === "string",
  );
  return first?.url;
}

/** Converts existing library rows into restyle asset entries. */
export function libraryAssetsFromRows(
  characters: DbCharacter[],
  scenes: DbScene[],
  props: DbProp[],
): RestyleAsset[] {
  return [
    ...characters.map((item) => ({
      id: `character:${item.id}`,
      name: item.name,
      kind: "character" as const,
      role: item.role_label || item.role || "",
      detail: [item.look, item.personality].filter(Boolean).join(" · "),
      color: "from-blue-500 via-violet-700 to-slate-950",
      imageUrl: findAssetImage(item.images, item.cover_url),
    })),
    ...scenes.map((item) => ({
      id: `scene:${item.id}`,
      name: item.name || item.location || "",
      kind: "scene" as const,
      role: item.location || "",
      detail: [item.action, item.time_of_day].filter(Boolean).join(" · "),
      color: "from-amber-400 via-orange-700 to-stone-950",
      imageUrl: findAssetImage(item.images, item.cover_url),
    })),
    ...props.map((item) => ({
      id: `prop:${item.id}`,
      name: item.name,
      kind: "prop" as const,
      role: "",
      detail: item.description || item.movement_description || "",
      color: "from-teal-400 via-cyan-700 to-slate-950",
      imageUrl: findAssetImage(item.images, item.cover_url),
    })),
  ];
}
