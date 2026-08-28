import { describe, expect, it } from "vitest";
import type { GenCharacter, GenScene } from "../../data/workspaceGenerators";
import {
  buildPosterPrompt,
  collectPosterReferences,
  decidePosterAction,
  MAX_POSTER_ATTEMPTS,
  pickLeadImageUrl,
  sameImageUrl,
} from "../projectPoster";

const char = (id: string, role: GenCharacter["role"], name = id): GenCharacter =>
  ({ id, name, role }) as unknown as GenCharacter;

const scene = (id: string, location = id): GenScene => ({ id, location }) as unknown as GenScene;

const base = {
  characters: [char("c1", "supporting", "配角甲"), char("c2", "lead", "主角乙")],
  charImages: { c1: ["http://img/c1.png"], c2: ["http://img/c2-old.png", "http://img/c2.png"] },
  scenes: [scene("s1", "客厅")],
  sceneImages: { s1: ["http://img/s1.png"] },
  currentCover: null as string | null,
  autoCoverUrl: null as string | null,
};

describe("pickLeadImageUrl", () => {
  it("优先取 lead 角色的最新图,而不是数组第一张", () => {
    expect(pickLeadImageUrl(base)).toBe("http://img/c2.png");
  });

  it("没有 lead 时退回第一个有图的角色", () => {
    expect(pickLeadImageUrl({ ...base, characters: [char("c1", "supporting")] })).toBe(
      "http://img/c1.png",
    );
  });

  it("跳过 data: 临时值,取钉选图优先", () => {
    expect(
      pickLeadImageUrl({
        ...base,
        charImages: { c2: ["data:image/png;base64,xxx", "http://img/c2.png"] },
        selectedCharImages: { c2: "http://img/c2-pinned.png" },
      }),
    ).toBe("http://img/c2-pinned.png");
  });

  it("兼容遗留 imageKey(charId::lookId)", () => {
    expect(
      pickLeadImageUrl({
        ...base,
        charImages: { "c2::look1": ["http://img/c2-look.png"] },
      }),
    ).toBe("http://img/c2-look.png");
  });
});

describe("collectPosterReferences", () => {
  it("主角图在前、场景图在后,名称/地点与顺序对齐", () => {
    const r = collectPosterReferences(base);
    expect(r.references).toEqual(["http://img/c2.png", "http://img/c1.png", "http://img/s1.png"]);
    expect(r.leadNames).toEqual(["主角乙", "配角甲"]);
    expect(r.sceneLocations).toEqual(["客厅"]);
  });

  it("角色参考最多 4 张、场景最多 3 张", () => {
    const many = {
      characters: Array.from({ length: 6 }, (_, i) => char(`c${i}`, "lead")),
      charImages: Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [`c${i}`, [`http://img/c${i}.png`]]),
      ),
      scenes: Array.from({ length: 5 }, (_, i) => scene(`s${i}`)),
      sceneImages: Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [`s${i}`, [`http://img/s${i}.png`]]),
      ),
    };
    const r = collectPosterReferences(many);
    expect(r.leadNames).toHaveLength(4);
    expect(r.sceneLocations).toHaveLength(3);
    expect(r.references).toHaveLength(7);
  });
});

describe("decidePosterAction", () => {
  it("剧照未生成 + 素材就绪 → generate", () => {
    const a = decidePosterAction({ ...base, poster: null });
    expect(a.type).toBe("generate");
    if (a.type === "generate") {
      expect(a.references[0]).toBe("http://img/c2.png");
      expect(a.references.at(-1)).toBe("http://img/s1.png");
    }
  });

  it("running 中不重复 generate;attempts 达上限后回退主角照片", () => {
    const running = decidePosterAction({
      ...base,
      poster: { url: null, status: "running", attempts: 0 },
    });
    expect(running).toEqual({ type: "setCover", url: "http://img/c2.png", source: "lead" });

    const exhausted = decidePosterAction({
      ...base,
      poster: { url: null, status: "failed", attempts: MAX_POSTER_ATTEMPTS },
    });
    expect(exhausted).toEqual({ type: "setCover", url: "http://img/c2.png", source: "lead" });
  });

  it("剧照已生成 → 用剧照覆盖自动封面", () => {
    const a = decidePosterAction({
      ...base,
      poster: { url: "http://img/poster.png", status: "succeeded", attempts: 1 },
      currentCover: "http://img/c2.png",
      autoCoverUrl: "http://img/c2.png",
    });
    expect(a).toEqual({ type: "setCover", url: "http://img/poster.png", source: "poster" });
  });

  it("剧照已生成且封面已是剧照 → none", () => {
    const a = decidePosterAction({
      ...base,
      poster: { url: "http://img/poster.png", status: "succeeded", attempts: 1 },
      currentCover: "http://img/poster.png",
      autoCoverUrl: "http://img/poster.png",
    });
    expect(a).toEqual({ type: "none" });
  });

  it("封面是导入项目自带的(≠ autoCoverUrl)→ 不动", () => {
    const a = decidePosterAction({
      ...base,
      poster: { url: "http://img/poster.png", status: "succeeded", attempts: 1 },
      currentCover: "http://img/user-set.png",
      autoCoverUrl: "http://img/c2.png",
    });
    expect(a).toEqual({ type: "none" });
  });

  it("无场景图 → 不生成,回退主角照片", () => {
    const a = decidePosterAction({ ...base, sceneImages: {}, poster: null });
    expect(a).toEqual({ type: "setCover", url: "http://img/c2.png", source: "lead" });
  });

  it("无角色图且无场景图 → legacy 兜底或 none", () => {
    const withLegacy = decidePosterAction({
      ...base,
      charImages: {},
      sceneImages: {},
      poster: null,
      legacyFallbackUrl: "http://img/storyboard.png",
    });
    expect(withLegacy).toEqual({
      type: "setCover",
      url: "http://img/storyboard.png",
      source: "fallback",
    });

    const none = decidePosterAction({ ...base, charImages: {}, sceneImages: {}, poster: null });
    expect(none).toEqual({ type: "none" });
  });

  it("当前封面已是主角照片 → none(不重复写)", () => {
    const a = decidePosterAction({
      ...base,
      sceneImages: {},
      poster: null,
      currentCover: "http://img/c2.png",
      autoCoverUrl: "http://img/c2.png",
    });
    expect(a).toEqual({ type: "none" });
  });
});

describe("sameImageUrl", () => {
  it("忽略签名 query 差异,同一路径视为同一张图", () => {
    expect(
      sameImageUrl(
        "https://oss.example.com/workspace-media/u/assets/poster/p.png?sign=aaa&expires=1",
        "https://oss.example.com/workspace-media/u/assets/poster/p.png?sign=bbb&expires=2",
      ),
    ).toBe(true);
    expect(sameImageUrl("http://a/x.png", "http://a/y.png")).toBe(false);
    expect(sameImageUrl(null, "http://a/x.png")).toBe(false);
  });

  it("封面是剧照的重签 URL → none(不因重签重复回写)", () => {
    const a = decidePosterAction({
      ...base,
      poster: { url: "http://img/poster.png?sign=old", status: "succeeded", attempts: 1 },
      currentCover: "http://img/poster.png?sign=new",
      autoCoverUrl: "http://img/poster.png?sign=old",
    });
    expect(a).toEqual({ type: "none" });
  });

  it("老项目(无 autoCoverUrl/poster 记录)的既有封面视为自动封面,可被主角照片替换", () => {
    const a = decidePosterAction({
      ...base,
      sceneImages: {},
      poster: null,
      autoCoverUrl: null,
      currentCover: "http://img/c1.png", // 旧逻辑挑的第一张角色图
    });
    expect(a).toEqual({ type: "setCover", url: "http://img/c2.png", source: "lead" });
  });
});

describe("buildPosterPrompt", () => {
  it("包含角色/场景清单与图序号、风格与禁令", () => {
    const p = buildPosterPrompt({
      leadNames: ["主角乙", "配角甲"],
      sceneLocations: ["客厅"],
      style: "写实",
    });
    expect(p).toContain("图1=「主角乙」(角色参考)");
    expect(p).toContain("图2=「配角甲」(角色参考)");
    expect(p).toContain("图3=「客厅」(场景参考)");
    expect(p).toContain("16:9");
    expect(p).toContain("写实");
    expect(p).toContain("[禁止]");
  });
});
