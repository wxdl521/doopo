/** 资产详情页和 Markdown 导出共用的数据形状；不包含演示资产。 */
export type AssetTab = "character" | "scene" | "prop";

export type CharacterAsset = {
  id: string; name: string; emoji: string; gradient: string; cover: string;
  views: { front: string; side: string; back: string; expression: string };
  images?: { url: string; label: string }[];
  role: string; age: string; personality: string; style: string; costume: string;
  appearance: string; background: string; palette: string[]; tags: string[]; summary: string;
};

export type SceneAsset = {
  id: string; name: string; emoji: string; gradient: string; time: string; mood: string;
  shot: string; lighting: string; sound: string; reference: string; tags: string[]; summary: string;
};

export type PropAsset = {
  id: string; name: string; emoji: string; gradient: string; owner: string;
  appearance: string; symbol: string; material: string; firstAppear: string;
  lastAppear: string; detail: string; tags: string[]; summary: string;
};
