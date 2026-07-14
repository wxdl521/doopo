/**
 * 一次性迁移脚本：把 Supabase `workspace-media` bucket 的历史文件
 * 迁移到腾讯云 COS + CDN，并把数据库里出现的旧 URL 重写成新的 CDN URL。
 *
 * 环境变量：
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION, COS_CDN_HOST
 *
 * 运行：
 *   bun run scripts/migrate-workspace-media-to-cos.ts           # dry run
 *   bun run scripts/migrate-workspace-media-to-cos.ts --apply   # 实际执行
 *
 * 幂等：CDN 上已存在的 key 会跳过重传；数据库 URL 已是 CDN 域名的行会跳过。
 */
import { createClient } from "@supabase/supabase-js";
import COS from "cos-nodejs-sdk-v5";

const APPLY = process.argv.includes("--apply");
const BUCKET = "workspace-media";
const CONCURRENCY = 8;

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COS_SECRET_ID = process.env.COS_SECRET_ID!;
const COS_SECRET_KEY = process.env.COS_SECRET_KEY!;
const COS_BUCKET = process.env.COS_BUCKET!;
const COS_REGION = process.env.COS_REGION!;
const COS_CDN_HOST = (process.env.COS_CDN_HOST || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

for (const [k, v] of Object.entries({
  SUPABASE_URL,
  SERVICE_KEY,
  COS_SECRET_ID,
  COS_SECRET_KEY,
  COS_BUCKET,
  COS_REGION,
  COS_CDN_HOST,
})) {
  if (!v) {
    console.error(`缺少必需的环境变量：${k}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cos = new COS({ SecretId: COS_SECRET_ID, SecretKey: COS_SECRET_KEY });

function cdnUrlForKey(key: string): string {
  return `https://${COS_CDN_HOST}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function cosHasKey(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: COS_BUCKET, Region: COS_REGION, Key: key }, (err) => {
      resolve(!err);
    });
  });
}

async function uploadKey(key: string, body: Buffer, contentType: string) {
  return new Promise<void>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

// ---------- Step 1: 列 bucket → 并发迁移文件 ----------

async function listAllKeys(prefix = ""): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, {
        limit: 1000,
        offset,
      });
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const item of data) {
        const full = dir ? `${dir}/${item.name}` : item.name;
        if (item.id === null) {
          // 目录
          await walk(full);
        } else {
          out.push(full);
        }
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }
  await walk(prefix);
  return out;
}

async function migrateFiles() {
  console.log(`[files] 列 workspace-media...`);
  const keys = await listAllKeys();
  console.log(`[files] 共 ${keys.length} 个对象`);
  let done = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  async function worker(pool: string[]) {
    while (pool.length) {
      const key = pool.shift()!;
      try {
        if (await cosHasKey(key)) {
          skipped++;
          continue;
        }
        if (!APPLY) {
          done++;
          continue;
        }
        const { data, error } = await supabase.storage.from(BUCKET).download(key);
        if (error || !data) throw error ?? new Error("download failed");
        const ct = data.type || "application/octet-stream";
        const buf = Buffer.from(await data.arrayBuffer());
        await uploadKey(key, buf, ct);
        done++;
      } catch (e: any) {
        failed++;
        errors.push(`${key}: ${e?.message ?? String(e)}`);
      }
      if ((done + skipped + failed) % 50 === 0) {
        console.log(`[files] progress ${done + skipped + failed}/${keys.length}`);
      }
    }
  }

  const pool = [...keys];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(pool)));
  console.log(`[files] done=${done} skipped=${skipped} failed=${failed}`);
  if (errors.length) console.log(`[files] errors:\n${errors.slice(0, 20).join("\n")}`);
  return keys;
}

// ---------- Step 2: 数据库 URL 重写 ----------

const SUPA_URL_RE = new RegExp(
  `https?://[^"'\\s)]*?/storage/v1/object/(?:public|sign)/${BUCKET}/([^"'\\s?)]+)(?:\\?[^"'\\s)]*)?`,
  "g",
);

function rewriteString(input: string | null | undefined): { changed: boolean; value: string } {
  if (!input) return { changed: false, value: input ?? "" };
  let changed = false;
  const value = input.replace(SUPA_URL_RE, (_, keyPart) => {
    changed = true;
    const decodedKey = decodeURIComponent(keyPart);
    return cdnUrlForKey(decodedKey);
  });
  return { changed, value };
}

function rewriteJson(input: any): { changed: boolean; value: any } {
  if (input == null) return { changed: false, value: input };
  if (typeof input === "string") return rewriteString(input);
  if (Array.isArray(input)) {
    let changed = false;
    const value = input.map((x) => {
      const r = rewriteJson(x);
      if (r.changed) changed = true;
      return r.value;
    });
    return { changed, value };
  }
  if (typeof input === "object") {
    let changed = false;
    const value: any = {};
    for (const [k, v] of Object.entries(input)) {
      const r = rewriteJson(v);
      if (r.changed) changed = true;
      value[k] = r.value;
    }
    return { changed, value };
  }
  return { changed: false, value: input };
}

async function rewriteTable(table: string, textCols: string[], jsonCols: string[] = []) {
  console.log(`\n[db] scanning ${table} cols=${[...textCols, ...jsonCols].join(",")}`);
  const selectCols = ["id", ...textCols, ...jsonCols].join(",");
  let from = 0;
  const PAGE = 500;
  let total = 0;
  let touched = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as any[]) {
      const update: Record<string, any> = {};
      for (const c of textCols) {
        const r = rewriteString(row[c]);
        if (r.changed) update[c] = r.value;
      }
      for (const c of jsonCols) {
        const r = rewriteJson(row[c]);
        if (r.changed) update[c] = r.value;
      }
      if (Object.keys(update).length) {
        touched++;
        if (APPLY) {
          const { error: upErr } = await supabase.from(table).update(update).eq("id", row.id);
          if (upErr) console.error(`[db] ${table}#${row.id} update failed: ${upErr.message}`);
        }
      }
    }
    total += data.length;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`[db] ${table}: scanned=${total} touched=${touched}`);
}

async function rewriteAllTables() {
  await rewriteTable("characters", ["cover_url"], ["images"]);
  await rewriteTable("scenes", ["cover_url"], ["images"]);
  await rewriteTable("props", ["cover_url"], ["images"]);
  await rewriteTable("projects", [], ["workspace_data"]);
  await rewriteTable("community_posts", ["cover_url"]);
  await rewriteTable("scripts", ["cover_url"]);
}

async function main() {
  console.log(`模式：${APPLY ? "APPLY (真实写入)" : "DRY RUN (加 --apply 才会写入)"}`);
  console.log(`CDN 域名：${COS_CDN_HOST}`);
  await migrateFiles();
  await rewriteAllTables();
  console.log("\n✓ done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});