/**
 * Local project import/export.
 *
 * Imported projects are stored in localStorage under `doopoo_imported_projects`
 * and merged into the Projects list page. The JSON schema is intentionally
 * permissive: only `title` is required; everything else is filled with
 * sensible defaults so users can import partial exports without errors.
 */

import type { ProjectMeta } from "../components/ProjectCard";
import { normalizeLegacyDeep } from "./legacyMigrate";
import { readFileAsTextWithProgress, type ReadProgress } from "./fileReadProgress";

const STORAGE_KEY = "doopoo_imported_projects";

export type ImportedProject = ProjectMeta & {
  importedAt: string;
  /** Original payload, preserved for the workspace/detail page to consume. */
  data?: Record<string, unknown>;
};

const GRADIENTS = [
  "from-fuchsia-600 via-purple-800 to-indigo-950",
  "from-emerald-600 via-teal-800 to-slate-950",
  "from-amber-500 via-rose-700 to-zinc-950",
  "from-sky-500 via-indigo-600 to-violet-900",
  "from-rose-700 via-blue-800 to-indigo-950",
  "from-teal-500 via-cyan-700 to-slate-900",
];

function pickGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function loadImportedProjects(): ImportedProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p === "object" && typeof p.id === "string");
  } catch {
    return [];
  }
}

export function saveImportedProject(project: ImportedProject): ImportedProject[] {
  const existing = loadImportedProjects();
  const next = [project, ...existing.filter((p) => p.id !== project.id)];
  saveImportedProjects(next);
  return next;
}

function saveImportedProjects(list: ImportedProject[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

export function removeImportedProject(id: string): ImportedProject[] {
  const next = loadImportedProjects().filter((p) => p.id !== id);
  saveImportedProjects(next);
  return next;
}

export class ProjectImportError extends Error {}

/** Parse a JSON string into a normalized ImportedProject. */
export function parseProjectJson(text: string): ImportedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectImportError("文件不是有效的 JSON / Invalid JSON file");
  }

  // Migrate legacy field names (e.g. doClaw → DooClaw, 资产库 → 资产).
  const data = normalizeLegacyDeep(raw) as Record<string, unknown>;

  const titleRaw =
    (data.title as string | undefined) ??
    (data.name as string | undefined) ??
    (data.projectName as string | undefined);

  if (!titleRaw || typeof titleRaw !== "string") {
    throw new ProjectImportError('缺少 title 字段 / Missing "title" field');
  }

  const id = (typeof data.id === "string" && data.id) || `imp-${Date.now().toString(36)}`;

  const allowedStatus = ["draft", "rendering", "ready"] as const;
  const status = allowedStatus.includes(data.status as (typeof allowedStatus)[number])
    ? (data.status as ProjectMeta["status"])
    : "draft";

  return {
    id,
    title: titleRaw.trim(),
    thumbnail:
      typeof data.thumbnail === "string" && data.thumbnail.startsWith("from-")
        ? data.thumbnail
        : pickGradient(id + titleRaw),
    status,
    updated: "just now",
    importedAt: new Date().toISOString(),
    data,
  };
}

/** Read a File and parse it WITHOUT persisting. Caller confirms before saving. */
export async function parseProjectFile(
  file: File,
  onProgress?: ReadProgress,
): Promise<ImportedProject> {
  if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
    throw new ProjectImportError("请选择 .json 文件 / Please select a .json file");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new ProjectImportError("文件过大（>5MB）/ File too large (>5MB)");
  }
  const text = await readFileAsTextWithProgress(file, onProgress);
  onProgress?.(95);
  const parsed = parseProjectJson(text);
  onProgress?.(100);
  return parsed;
}
