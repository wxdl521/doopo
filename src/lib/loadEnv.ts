// ====================================================================
//  .env.local loader —— 修复 Vite v7 + TanStack Start dev mode 坑
//
//  问题:Vite v7 + TanStack Start 在 dev mode 下,**只**把带 `VITE_` 前缀的
//  env 注入到 import.meta.env;非 VITE_ 前缀的(如 ARK_API_KEY、Qwen)不会
//  自动加载到 process.env。结果:server function 里的 process.env.ARK_API_KEY
//  一直是 undefined。
//
//  实现:动态 import node:fs(不能用静态 import —— Vite 客户端 bundle 会
//  报错 "Module 'node:fs' has been externalized for browser compatibility")。
//  动态 import 会被 Vite 原样保留在客户端 bundle,运行时在浏览器里失败,
//  被 try/catch 静默吞掉。Server 端动态 import 正常工作,加载 .env.local。
// ====================================================================

let loaded = false;

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  // 直接 fire-and-forget;函数顶部 typeof window === 'undefined' 守卫
  // 会在浏览器里立即 return。Server 端会异步加载 .env.local (~1ms),
  // 调用方继续执行时 process.env.ARK_* 即可用。
  void tryLoadLocalEnv();
}

async function tryLoadLocalEnv() {
  // 在浏览器里 typeof window !== 'undefined',直接 no-op(不调用 fs)
  if (typeof window !== "undefined") return;

  let readFileSync: typeof import("node:fs").readFileSync;
  let existsSync: typeof import("node:fs").existsSync;
  let join: typeof import("node:path").join;
  let dirname: typeof import("node:path").dirname;
  try {
    // 动态 import —— 客户端 bundle 保留 import 表达式,运行时 fail 在 try/catch 里
    const fs = await import("node:fs");
    const path = await import("node:path");
    readFileSync = fs.readFileSync;
    existsSync = fs.existsSync;
    join = path.join;
    dirname = path.dirname;
  } catch {
    return; // 客户端或任何拿不到 fs 的环境,静默退出
  }

  // 从 process.cwd() 向上 5 层找 .env.local
  let dir = process.cwd();
  let envPath: string | null = null;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) {
      envPath = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!envPath) return;

  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  let count = 0;
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (!rawVal) continue;
    // 不覆盖 OS env 里已设的值(让 Cloudflare / Docker env 优先)
    if (process.env[key] && process.env[key] !== "") continue;
    // 去引号
    process.env[key] = rawVal.replace(/^['"]|['"]$/g, "");
    count++;
  }

  if (count > 0) {
    console.error(`[loadEnv] loaded ${count} vars from ${envPath}`);
  }
}

// 顶层副作用:导入即加载。Server 函数模块顶部
// `import './loadEnv'` 就能保证 process.env 在读取前已就绪。
loadLocalEnv();
