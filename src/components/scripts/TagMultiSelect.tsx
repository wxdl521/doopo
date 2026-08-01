import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Lock, Search, X } from "lucide-react";
import {
  scriptGroupLabel,
  scriptTagLabel,
  type ScriptTagDef,
  type ScriptTagGroup,
} from "../../lib/scriptTags";

type Props = {
  groups: ScriptTagGroup[];
  selected: string[];
  onChange: (values: string[]) => void;
  onLocked: (label: string) => void;
  lang: string;
  placeholder: string;
  searchPlaceholder: string;
  clearLabel: string;
};

/**
 * 题材 / 风格分组下拉多选。
 * 收起态显示已选 chip（可点 × 移除），展开态在浮层里按分组勾选，支持搜索。
 */
export default function TagMultiSelect({
  groups,
  selected,
  onChange,
  onLocked,
  lang,
  placeholder,
  searchPlaceholder,
  clearLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byValue = useMemo(() => {
    const map = new Map<string, ScriptTagDef>();
    for (const g of groups) for (const tag of g.tags) map.set(tag.value, tag);
    return map;
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        tags: g.tags.filter(
          (tag) =>
            tag.zh.toLowerCase().includes(q) ||
            tag.en.toLowerCase().includes(q) ||
            tag.value.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.tags.length > 0);
  }, [groups, query]);

  const toggle = (tag: ScriptTagDef) => {
    if (tag.locked) {
      onLocked(scriptTagLabel(tag, lang));
      return;
    }
    if (selected.includes(tag.value)) onChange(selected.filter((v) => v !== tag.value));
    else onChange([...selected, tag.value]);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[42px] flex items-start gap-2 px-2 py-1.5 rounded-lg bg-bg-elevated border border-border text-left hover:border-accent/40 transition-colors"
      >
        <span className="flex-1 flex flex-wrap gap-1.5 items-center">
          {selected.length === 0 && (
            <span className="text-xs text-text-muted py-1">{placeholder}</span>
          )}
          {selected.map((value) => {
            const tag = byValue.get(value);
            return (
              <span
                key={value}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-accent/20 border-accent text-accent"
              >
                {tag ? scriptTagLabel(tag, lang) : value}
                <X
                  size={11}
                  className="opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(selected.filter((v) => v !== value));
                  }}
                />
              </span>
            );
          })}
        </span>
        <ChevronDown
          size={14}
          className={`mt-1.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 rounded-xl border border-border bg-bg-surface shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={13} className="text-text-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] text-text-muted hover:text-accent"
              >
                {clearLabel}
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto p-2 space-y-3">
            {filtered.map((group) => (
              <div key={group.id}>
                <div className="text-[11px] uppercase tracking-wide text-text-muted px-1 mb-1.5">
                  {scriptGroupLabel(group, lang)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.tags.map((tag) => {
                    const isSelected = selected.includes(tag.value);
                    return (
                      <button
                        key={tag.value}
                        type="button"
                        onClick={() => toggle(tag)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
                          tag.locked
                            ? "bg-bg-base border-border text-text-muted hover:border-rose-500/50 hover:text-rose-400"
                            : isSelected
                              ? "bg-accent/20 border-accent text-accent"
                              : "bg-bg-base border-border text-text-secondary hover:border-accent/40"
                        }`}
                      >
                        {tag.locked ? <Lock size={10} /> : isSelected ? <Check size={11} /> : null}
                        {scriptTagLabel(tag, lang)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="py-6 text-center text-xs text-text-muted">—</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
