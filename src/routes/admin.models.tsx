import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { useListedModels } from "@/hooks/useListedModels";
import { realImageModelOptions, realVideoModels } from "@/components/NewProjectDialog";
import {
  deleteModelPricing,
  listModelPricing,
  upsertModelPricing,
} from "@/lib/modelPricing.functions";
import type { ModelPricingKind, ModelPricingRow } from "@/lib/modelPricingCache";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/admin/models")({
  component: AdminModels,
});

type EditableRow = ModelPricingRow & { dirty: boolean; isNew: boolean };

function toEditable(row: ModelPricingRow): EditableRow {
  return { ...row, dirty: false, isNew: false };
}

let newRowSeq = 0;
function blankRow(): EditableRow {
  newRowSeq += 1;
  return {
    id: `new-${newRowSeq}`,
    kind: "video",
    modelId: "",
    label: "",
    resolution: null,
    credits: 0,
    note: null,
    isDefault: false,
    enabled: true,
    sortOrder: 0,
    dirty: true,
    isNew: true,
  };
}

function AdminModels() {
  const { t } = useLanguage();
  const callList = useServerFn(listModelPricing);
  const callUpsert = useServerFn(upsertModelPricing);
  const callDelete = useServerFn(deleteModelPricing);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 已上架目录（供应商管理）：模型 id 可下拉选择，仍可手填
  const { models: listedImageModels } = useListedModels("image", realImageModelOptions);
  const { models: listedVideoModels } = useListedModels("video", realVideoModels);
  // 已上架但未定价提醒条
  const unpricedListed = [...listedImageModels, ...listedVideoModels].filter((m) => !m.priced);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setDeletedIds([]);
    const result: any = await callList({ data: {} });
    setLoading(false);
    if (result?.error) {
      toast.error(result.error);
      setRows([]);
      return;
    }
    setRows(((result?.rows ?? []) as ModelPricingRow[]).map(toEditable));
  }, [callList]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const patchRow = (id: string, patch: Partial<EditableRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch, dirty: true } : row)),
    );
  };

  const setDefault = (id: string) => {
    setRows((current) => {
      const target = current.find((row) => row.id === id);
      if (!target) return current;
      // 同一类型只保留一个默认推荐
      return current.map((row) =>
        row.kind === target.kind ? { ...row, isDefault: row.id === id, dirty: true } : row,
      );
    });
  };

  const removeRow = (row: EditableRow) => {
    if (!row.isNew) setDeletedIds((current) => [...current, row.id]);
    setRows((current) => current.filter((item) => item.id !== row.id));
  };

  const hasChanges = deletedIds.length > 0 || rows.some((row) => row.dirty);

  const save = async () => {
    setSaving(true);
    let failed = false;
    for (const id of deletedIds) {
      const result: any = await callDelete({ data: { id } });
      if (!result?.ok) {
        failed = true;
        toast.error(result?.error || t.admin_models_save_error);
      }
    }
    for (const row of rows) {
      if (!row.dirty) continue;
      const result: any = await callUpsert({
        data: {
          id: row.isNew ? undefined : row.id,
          kind: row.kind,
          modelId: row.modelId,
          label: row.label,
          resolution: row.resolution || null,
          credits: row.credits,
          note: row.note || null,
          isDefault: row.isDefault,
          enabled: row.enabled,
          sortOrder: row.sortOrder,
        },
      });
      if (!result?.ok) {
        failed = true;
        toast.error(result?.error || t.admin_models_save_error);
      }
    }
    setSaving(false);
    if (!failed) toast.success(t.admin_models_saved);
    await loadRows();
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.admin_models_pricing_title} subtitle={t.admin_models_pricing_sub} />

      {/* 已上架目录下拉（仍可手填模型 id / 前缀） */}
      <datalist id="pricing-catalog-image">
        {listedImageModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </datalist>
      <datalist id="pricing-catalog-video">
        {listedVideoModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </datalist>

      {unpricedListed.length > 0 ? (
        <div className="rounded-lg border border-amber-400/60 bg-amber-500/10 px-4 py-3 text-xs text-amber-500">
          <span className="font-medium">{t.admin_models_unpriced_banner}</span>
          <span className="ml-1">{unpricedListed.map((m) => m.label).join("、")}</span>
        </div>
      ) : null}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <button
            onClick={() => setRows((current) => [...current, blankRow()])}
            className="btn-ghost inline-flex items-center gap-2"
          >
            <Plus size={15} />
            {t.admin_models_add}
          </button>
          <div className="flex items-center gap-3">
            {hasChanges && <span className="text-xs text-amber-500">{t.admin_models_unsaved}</span>}
            <button
              onClick={() => void save()}
              disabled={!hasChanges || saving}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? t.admin_models_saving : t.admin_models_save}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated/60 text-text-muted">
              <tr>
                <th className="px-3 py-3 text-left font-medium">{t.admin_models_col_kind}</th>
                <th className="px-3 py-3 text-left font-medium">{t.admin_models_col_model}</th>
                <th className="px-3 py-3 text-left font-medium">{t.admin_models_col_resolution}</th>
                <th className="px-3 py-3 text-right font-medium">{t.admin_models_col_credits}</th>
                <th className="px-3 py-3 text-left font-medium">{t.admin_models_col_note}</th>
                <th className="px-3 py-3 text-center font-medium">{t.admin_models_col_default}</th>
                <th className="px-3 py-3 text-center font-medium">{t.admin_models_col_enabled}</th>
                <th className="px-3 py-3 text-right font-medium">{t.admin_models_col_sort}</th>
                <th className="px-3 py-3 text-center font-medium">{t.admin_models_col_actions}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-text-muted">
                    {t.admin_models_loading}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-text-muted">
                    {t.admin_models_empty}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-border ${row.enabled ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2">
                      <select
                        value={row.kind}
                        onChange={(event) =>
                          patchRow(row.id, { kind: event.target.value as ModelPricingKind })
                        }
                        className="rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm"
                      >
                        <option value="video">{t.admin_models_kind_video}</option>
                        <option value="image">{t.admin_models_kind_image}</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={row.label}
                        onChange={(event) => patchRow(row.id, { label: event.target.value })}
                        placeholder={t.admin_models_label_placeholder}
                        className="mb-1"
                      />
                      <Input
                        value={row.modelId}
                        onChange={(event) => patchRow(row.id, { modelId: event.target.value })}
                        placeholder={t.admin_models_model_id_placeholder}
                        list={`pricing-catalog-${row.kind}`}
                        className="font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={row.resolution ?? ""}
                        onChange={(event) =>
                          patchRow(row.id, { resolution: event.target.value || null })
                        }
                        placeholder="720P"
                        className="w-20"
                        disabled={row.kind === "image"}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={String(row.credits)}
                        onChange={(event) =>
                          patchRow(row.id, { credits: Number(event.target.value) || 0 })
                        }
                        className="w-24 text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={row.note ?? ""}
                        onChange={(event) => patchRow(row.id, { note: event.target.value || null })}
                        className="min-w-[140px]"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setDefault(row.id)}
                        className={`rounded-md p-1.5 transition ${
                          row.isDefault
                            ? "text-amber-500"
                            : "text-text-muted hover:text-text-primary"
                        }`}
                        aria-label={t.admin_models_set_default}
                        title={t.admin_models_set_default}
                      >
                        <Star size={16} fill={row.isDefault ? "currentColor" : "none"} />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) => patchRow(row.id, { enabled: event.target.checked })}
                        className="h-4 w-4 accent-accent"
                        aria-label={t.admin_models_col_enabled}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={String(row.sortOrder)}
                        onChange={(event) =>
                          patchRow(row.id, {
                            sortOrder: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                          })
                        }
                        className="w-20 text-right"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => removeRow(row)}
                        className="rounded-md p-1.5 text-text-muted transition hover:text-red-500"
                        aria-label={t.admin_models_delete}
                        title={t.admin_models_delete}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
