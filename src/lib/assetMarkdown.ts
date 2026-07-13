import type { AssetTab, CharacterAsset, SceneAsset, PropAsset } from "../data/assetTypes";

type Labels = {
  role: string;
  age: string;
  personality: string;
  style: string;
  costume: string;
  appearance: string;
  background: string;
  palette: string;
  tags: string;
  time: string;
  mood: string;
  shot: string;
  lighting: string;
  sound: string;
  reference: string;
  owner: string;
  symbol: string;
  material: string;
  firstAppear: string;
  lastAppear: string;
  detail: string;
  summary: string;
};

export function characterToMd(c: CharacterAsset, L: Labels) {
  return [
    `# ${c.name}`,
    `> ${L.tags}：${c.tags.join(" · ")}`,
    ``,
    `## ${L.summary}`,
    c.summary,
    ``,
    `## ${c.role}`,
    `- ${L.role}：${c.role}`,
    `- ${L.age}：${c.age}`,
    `- ${L.personality}：${c.personality}`,
    `- ${L.style}：${c.style}`,
    `- ${L.costume}：${c.costume}`,
    ``,
    `## ${L.appearance}`,
    c.appearance,
    ``,
    `## ${L.background}`,
    c.background,
    ``,
    `## ${L.palette}`,
    c.palette.map((p) => `- \`${p}\``).join("\n"),
    ``,
  ].join("\n");
}

export function sceneToMd(s: SceneAsset, L: Labels) {
  return [
    `# ${s.name}`,
    `> ${L.tags}：${s.tags.join(" · ")}`,
    ``,
    `## ${L.summary}`,
    s.summary,
    ``,
    `## ${L.shot}`,
    `- ${L.time}：${s.time}`,
    `- ${L.mood}：${s.mood}`,
    `- ${L.shot}：${s.shot}`,
    `- ${L.lighting}：${s.lighting}`,
    `- ${L.sound}：${s.sound}`,
    `- ${L.reference}：${s.reference}`,
    ``,
  ].join("\n");
}

export function propToMd(p: PropAsset, L: Labels) {
  return [
    `# ${p.name}`,
    `> ${L.tags}：${p.tags.join(" · ")}`,
    ``,
    `## ${L.summary}`,
    p.summary,
    ``,
    `## ${L.detail}`,
    `- ${L.owner}：${p.owner}`,
    `- ${L.appearance}：${p.appearance}`,
    `- ${L.firstAppear}：${p.firstAppear}`,
    `- ${L.lastAppear}：${p.lastAppear}`,
    `- ${L.material}：${p.material}`,
    `- ${L.symbol}：${p.symbol}`,
    ``,
    p.detail,
    ``,
  ].join("\n");
}

export function assetToMarkdown(
  tab: AssetTab,
  asset: CharacterAsset | SceneAsset | PropAsset,
  labels: Labels,
): string {
  if (tab === "character") return characterToMd(asset as CharacterAsset, labels);
  if (tab === "scene") return sceneToMd(asset as SceneAsset, labels);
  return propToMd(asset as PropAsset, labels);
}

export function downloadMarkdown(filename: string, md: string) {
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
