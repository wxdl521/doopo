// ====================================================================
//  后台「供应商管理」（/admin/providers，侧栏位于「模型定价」上方）
//
//  供应商卡片列表 + 每张卡片内的模型子表（模型名 / 类型 / 能力 / 上架 /
//  启用 / 排序 / 定价状态）。新增与编辑用与 AssetEditDialog 同款外壳的
//  自建 Dialog；密钥输入 type=password，编辑时显示 ****尾4位、留空不改。
// ====================================================================

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/LanguageContext";
import type { Translations } from "@/i18n/zh";
import {
  deleteProvider,
  deleteProviderModel,
  listProviderModels,
  listProviders,
  testProviderConnection,
  toggleModelEnabled,
  toggleModelListing,
  upsertProvider,
  upsertProviderModel,
} from "@/lib/aiProviders.functions";
import type { AiProviderModelRow, AiProviderRow, ModelCapabilities } from "@/lib/aiProvidersCache";

export const Route = createFileRoute("/admin/providers")({
  component: AdminProviders,
});

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

const KIND_LABEL_KEYS: Record<string, keyof Translations> = {
  image: "admin_models_kind_image",
  video: "admin_models_kind_video",
};

// --------------------------------------------------------------------
// Dialog 外壳（与 AssetEditDialog 一致：遮罩 + Esc 关闭 + 右上 X）
// --------------------------------------------------------------------
function DialogShell({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`max-h-[85vh] w-full ${wide ? "max-w-2xl" : "max-w-lg"} overflow-y-auto rounded-2xl border border-border bg-bg-surface shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={title}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-text-muted">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-text-muted">{hint}</p> : null}
    </div>
  );
}

// --------------------------------------------------------------------
// 供应商新增 / 编辑 Dialog
// --------------------------------------------------------------------
type ProviderDraft = {
  code: string;
  name: string;
  kind: "openai_compatible" | "builtin";
  baseUrl: string;
  apiKey: string;
  envKeyName: string;
  enabled: boolean;
  sortOrder: number;
};

function blankProviderDraft(): ProviderDraft {
  return {
    code: "",
    name: "",
    kind: "openai_compatible",
    baseUrl: "",
    apiKey: "",
    envKeyName: "",
    enabled: true,
    sortOrder: 0,
  };
}

function ProviderDialog({
  open,
  provider,
  onClose,
  onSaved,
  t,
}: {
  open: boolean;
  provider: AiProviderRow | null;
  onClose: () => void;
  onSaved: () => void;
  t: Translations;
}) {
  const callUpsert = useServerFn(upsertProvider);
  const [draft, setDraft] = useState<ProviderDraft>(blankProviderDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      provider
        ? {
            code: provider.code,
            name: provider.name,
            kind: provider.kind,
            baseUrl: provider.baseUrl ?? "",
            apiKey: "",
            envKeyName: provider.envKeyName ?? "",
            enabled: provider.enabled,
            sortOrder: provider.sortOrder,
          }
        : blankProviderDraft(),
    );
  }, [open, provider]);

  const patch = (p: Partial<ProviderDraft>) => setDraft((d) => ({ ...d, ...p }));
  const invalid = !draft.code.trim() || !draft.name.trim();

  async function save() {
    if (invalid) return;
    setSaving(true);
    const result: any = await callUpsert({
      data: {
        id: provider?.id,
        code: draft.code.trim(),
        name: draft.name.trim(),
        kind: draft.kind,
        baseUrl: draft.baseUrl.trim() || null,
        apiKey: draft.apiKey || null,
        envKeyName: draft.envKeyName.trim() || null,
        enabled: draft.enabled,
        sortOrder: draft.sortOrder,
      },
    });
    setSaving(false);
    if (!result?.ok) {
      toast.error(result?.error || t.admin_providers_save_error);
      return;
    }
    toast.success(t.admin_providers_saved);
    onSaved();
    onClose();
  }

  return (
    <DialogShell
      open={open}
      title={provider ? t.admin_providers_edit : t.admin_providers_add}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            {t.common_cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={invalid || saving}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? t.admin_providers_saving : t.admin_providers_save}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.admin_providers_code} hint={t.admin_providers_code_hint}>
          <Input
            value={draft.code}
            onChange={(e) => patch({ code: e.target.value })}
            placeholder="otu"
            className="font-mono"
          />
        </Field>
        <Field label={t.admin_providers_name}>
          <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
      </div>
      <Field label={t.admin_providers_kind}>
        <select
          value={draft.kind}
          onChange={(e) => patch({ kind: e.target.value as ProviderDraft["kind"] })}
          className={FIELD_CLASS}
        >
          <option value="openai_compatible">{t.admin_providers_kind_openai}</option>
          <option value="builtin">{t.admin_providers_kind_builtin}</option>
        </select>
      </Field>
      <Field label={t.admin_providers_base_url}>
        <Input
          value={draft.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
          placeholder="https://api.example.com"
          className="font-mono"
        />
      </Field>
      {draft.kind === "builtin" ? (
        <Field label={t.admin_providers_env_key} hint={t.admin_providers_env_key_hint}>
          <Input
            value={draft.envKeyName}
            onChange={(e) => patch({ envKeyName: e.target.value })}
            placeholder="ARK_API_KEY"
            className="font-mono"
          />
        </Field>
      ) : (
        <Field
          label={t.admin_providers_api_key}
          hint={
            provider?.apiKeyHint
              ? `${provider.apiKeyHint} · ${t.admin_providers_api_key_keep}`
              : undefined
          }
        >
          <Input
            type="password"
            value={draft.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder={provider?.apiKeyHint ?? "sk-…"}
            autoComplete="new-password"
            className="font-mono"
          />
        </Field>
      )}
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t.admin_providers_enabled}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{t.admin_providers_sort}</span>
          <Input
            type="number"
            min="0"
            step="1"
            value={String(draft.sortOrder)}
            onChange={(e) =>
              patch({ sortOrder: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
            className="w-24"
          />
        </div>
      </div>
    </DialogShell>
  );
}

// --------------------------------------------------------------------
// 模型新增 / 编辑 Dialog
// --------------------------------------------------------------------
type ModelDraft = {
  modelId: string;
  label: string;
  kind: "image" | "video" | "text";
  t2i: boolean;
  i2i: boolean;
  maxRefs: number;
  editsProtocol: "json" | "multipart";
  authHeader: "bearer" | "x-api-key";
  listed: boolean;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  note: string;
};

function blankModelDraft(): ModelDraft {
  return {
    modelId: "",
    label: "",
    kind: "image",
    t2i: true,
    i2i: true,
    maxRefs: 10,
    editsProtocol: "multipart",
    authHeader: "bearer",
    listed: false,
    enabled: true,
    isDefault: false,
    sortOrder: 0,
    note: "",
  };
}

function ModelDialog({
  open,
  provider,
  model,
  onClose,
  onSaved,
  t,
}: {
  open: boolean;
  provider: AiProviderRow;
  model: AiProviderModelRow | null;
  onClose: () => void;
  onSaved: () => void;
  t: Translations;
}) {
  const callUpsert = useServerFn(upsertProviderModel);
  const [draft, setDraft] = useState<ModelDraft>(blankModelDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (model) {
      const caps = model.capabilities ?? ({} as ModelCapabilities);
      setDraft({
        modelId: model.modelId,
        label: model.label,
        kind: model.kind,
        t2i: caps.t2i !== false,
        i2i: caps.i2i !== false,
        maxRefs: caps.max_reference_images ?? 10,
        editsProtocol: caps.edits_protocol ?? "multipart",
        authHeader: caps.auth_header ?? "bearer",
        listed: model.listed,
        enabled: model.enabled,
        isDefault: model.isDefault,
        sortOrder: model.sortOrder,
        note: model.note ?? "",
      });
    } else {
      setDraft(blankModelDraft());
    }
  }, [open, model]);

  const patch = (p: Partial<ModelDraft>) => setDraft((d) => ({ ...d, ...p }));
  const invalid = !draft.modelId.trim() || !draft.label.trim();

  async function save() {
    if (invalid) return;
    setSaving(true);
    const capabilities: ModelCapabilities = {
      t2i: draft.t2i,
      i2i: draft.i2i,
      max_reference_images: draft.maxRefs,
      edits_protocol: draft.editsProtocol,
      auth_header: draft.authHeader,
    };
    const result: any = await callUpsert({
      data: {
        id: model?.id,
        providerId: provider.id,
        modelId: draft.modelId.trim(),
        label: draft.label.trim(),
        kind: draft.kind,
        capabilities,
        listed: draft.listed,
        enabled: draft.enabled,
        isDefault: draft.isDefault,
        sortOrder: draft.sortOrder,
        note: draft.note.trim() || null,
      },
    });
    setSaving(false);
    if (!result?.ok) {
      toast.error(result?.error || t.admin_providers_save_error);
      return;
    }
    toast.success(t.admin_providers_saved);
    onSaved();
    onClose();
  }

  const isBuiltin = provider.kind === "builtin";

  return (
    <DialogShell
      open={open}
      title={`${model ? t.admin_providers_edit_model : t.admin_providers_add_model} · ${provider.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            {t.common_cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={invalid || saving}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? t.admin_providers_saving : t.admin_providers_save}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t.admin_providers_model_id}
          hint={
            isBuiltin
              ? t.admin_providers_model_id_hint_builtin
              : t.admin_providers_model_id_hint_dynamic
          }
        >
          <Input
            value={draft.modelId}
            onChange={(e) => patch({ modelId: e.target.value })}
            placeholder={isBuiltin ? "pixflow/gpt-image-2" : "gpt-image-2"}
            className="font-mono"
          />
        </Field>
        <Field label={t.admin_providers_model_label}>
          <Input value={draft.label} onChange={(e) => patch({ label: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t.admin_providers_col_kind}>
          <select
            value={draft.kind}
            onChange={(e) => patch({ kind: e.target.value as ModelDraft["kind"] })}
            className={FIELD_CLASS}
          >
            <option value="image">{t.admin_models_kind_image}</option>
            <option value="video">{t.admin_models_kind_video}</option>
            <option value="text">text</option>
          </select>
        </Field>
        <Field label={t.admin_providers_caps_edits_protocol}>
          <select
            value={draft.editsProtocol}
            onChange={(e) => patch({ editsProtocol: e.target.value as "json" | "multipart" })}
            className={FIELD_CLASS}
          >
            <option value="json">json</option>
            <option value="multipart">multipart</option>
          </select>
        </Field>
        <Field label={t.admin_providers_caps_auth_header}>
          <select
            value={draft.authHeader}
            onChange={(e) => patch({ authHeader: e.target.value as "bearer" | "x-api-key" })}
            className={FIELD_CLASS}
          >
            <option value="bearer">bearer</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={draft.t2i}
            onChange={(e) => patch({ t2i: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t.admin_providers_caps_t2i}
        </label>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={draft.i2i}
            onChange={(e) => patch({ i2i: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t.admin_providers_caps_i2i}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{t.admin_providers_caps_max_refs}</span>
          <Input
            type="number"
            min="0"
            max="20"
            step="1"
            value={String(draft.maxRefs)}
            onChange={(e) =>
              patch({ maxRefs: Math.min(20, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
            }
            className="w-20"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{t.admin_providers_sort}</span>
          <Input
            type="number"
            min="0"
            step="1"
            value={String(draft.sortOrder)}
            onChange={(e) =>
              patch({ sortOrder: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
            }
            className="w-20"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={draft.listed}
            onChange={(e) => patch({ listed: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t.admin_providers_col_listed}
        </label>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t.admin_providers_col_enabled}
        </label>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={draft.isDefault}
            onChange={(e) => patch({ isDefault: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          {t.admin_models_col_default}
        </label>
      </div>
      <Field label={t.admin_providers_model_note}>
        <Input value={draft.note} onChange={(e) => patch({ note: e.target.value })} />
      </Field>
    </DialogShell>
  );
}

// --------------------------------------------------------------------
// 页面主体
// --------------------------------------------------------------------
function capabilitiesSummary(caps: ModelCapabilities): string {
  const parts: string[] = [];
  if (caps.t2i) parts.push("t2i");
  if (caps.i2i) parts.push("i2i");
  if (typeof caps.max_reference_images === "number")
    parts.push(`refs≤${caps.max_reference_images}`);
  parts.push(caps.edits_protocol);
  parts.push(caps.auth_header);
  return parts.join(" · ");
}

function AdminProviders() {
  const { t } = useLanguage();
  const callListProviders = useServerFn(listProviders);
  const callListModels = useServerFn(listProviderModels);
  const callDeleteProvider = useServerFn(deleteProvider);
  const callDeleteModel = useServerFn(deleteProviderModel);
  const callToggleListing = useServerFn(toggleModelListing);
  const callToggleEnabled = useServerFn(toggleModelEnabled);
  const callTest = useServerFn(testProviderConnection);

  const [providers, setProviders] = useState<AiProviderRow[]>([]);
  const [models, setModels] = useState<AiProviderModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerDialog, setProviderDialog] = useState<{
    open: boolean;
    provider: AiProviderRow | null;
  }>({
    open: false,
    provider: null,
  });
  const [modelDialog, setModelDialog] = useState<{
    open: boolean;
    provider: AiProviderRow | null;
    model: AiProviderModelRow | null;
  }>({ open: false, provider: null, model: null });
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, m]: any[] = await Promise.all([
      callListProviders({ data: undefined }),
      callListModels({ data: {} }),
    ]);
    setLoading(false);
    if (p?.error) toast.error(p.error);
    if (m?.error) toast.error(m.error);
    setProviders(p?.rows ?? []);
    setModels(m?.rows ?? []);
  }, [callListProviders, callListModels]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelsOf = (providerId: string) => models.filter((m) => m.providerId === providerId);

  async function removeProvider(provider: AiProviderRow) {
    if (!window.confirm(t.admin_providers_delete_confirm)) return;
    const result: any = await callDeleteProvider({ data: { id: provider.id } });
    if (!result?.ok) {
      toast.error(result?.error || t.admin_providers_save_error);
      return;
    }
    toast.success(t.admin_providers_saved);
    void load();
  }

  async function removeModel(model: AiProviderModelRow) {
    const result: any = await callDeleteModel({ data: { id: model.id } });
    if (!result?.ok) {
      toast.error(result?.error || t.admin_providers_save_error);
      return;
    }
    void load();
  }

  async function toggle(model: AiProviderModelRow, field: "listed" | "enabled") {
    const call = field === "listed" ? callToggleListing : callToggleEnabled;
    const result: any = await call({ data: { id: model.id, value: !model[field] } });
    if (!result?.ok) {
      toast.error(result?.error || t.admin_providers_save_error);
      return;
    }
    setModels((current) =>
      current.map((m) => (m.id === model.id ? { ...m, [field]: !model[field] } : m)),
    );
  }

  async function testConnection(provider: AiProviderRow) {
    setTestingId(provider.id);
    const result: any = await callTest({ data: { id: provider.id } });
    setTestingId(null);
    if (result?.ok) {
      toast.success(
        t.admin_providers_test_ok
          .replace("{status}", String(result.status))
          .replace("{ms}", String(result.durationMs)),
      );
      // 分型探测的附带说明（未配置密钥仅验连通性/端点未实测等）
      if (result?.note) toast.message(result.note);
    } else {
      toast.error(`${t.admin_providers_test_fail}: ${result?.error ?? ""}`);
      if (result?.note) toast.message(result.note);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.admin_providers_title} subtitle={t.admin_providers_sub} />

      <div className="flex items-center gap-3">
        <button
          onClick={() => setProviderDialog({ open: true, provider: null })}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus size={15} />
          {t.admin_providers_add}
        </button>
        <button onClick={() => void load()} className="btn-ghost inline-flex items-center gap-2">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-text-muted">{t.admin_providers_loading}</div>
      ) : providers.length === 0 ? (
        <div className="py-16 text-center text-text-muted">{t.admin_providers_empty}</div>
      ) : (
        providers.map((provider) => {
          const providerModels = modelsOf(provider.id);
          return (
            <section key={provider.id} className="panel overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text-primary">{provider.name}</span>
                    <code className="rounded bg-bg-elevated px-1.5 py-0.5 text-[11px] text-text-muted">
                      {provider.code}
                    </code>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
                      {provider.kind === "builtin"
                        ? t.admin_providers_kind_builtin
                        : t.admin_providers_kind_openai}
                    </span>
                    {!provider.enabled && (
                      <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
                        {t.admin_models_col_enabled}: off
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-text-muted">
                    {provider.baseUrl || provider.envKeyName || ""}
                    {provider.apiKeyHint ? ` · ${provider.apiKeyHint}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void testConnection(provider)}
                  disabled={testingId === provider.id}
                  className="btn-ghost text-xs disabled:opacity-50"
                >
                  {testingId === provider.id ? t.admin_providers_testing : t.admin_providers_test}
                </button>
                <button
                  onClick={() => setModelDialog({ open: true, provider, model: null })}
                  className="btn-ghost inline-flex items-center gap-1 text-xs"
                >
                  <Plus size={13} />
                  {t.admin_providers_add_model}
                </button>
                <button
                  onClick={() => setProviderDialog({ open: true, provider })}
                  className="rounded-md p-1.5 text-text-muted transition hover:text-text-primary"
                  aria-label={t.admin_providers_edit}
                  title={t.admin_providers_edit}
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => void removeProvider(provider)}
                  className="rounded-md p-1.5 text-text-muted transition hover:text-red-500"
                  aria-label={t.admin_providers_delete}
                  title={t.admin_providers_delete}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {providerModels.length === 0 ? (
                <div className="px-5 py-6 text-center text-xs text-text-muted">
                  {t.admin_providers_no_models}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-elevated/60 text-text-muted">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-medium">
                          {t.admin_providers_col_model}
                        </th>
                        <th className="px-3 py-2.5 text-left font-medium">
                          {t.admin_providers_col_kind}
                        </th>
                        <th className="px-3 py-2.5 text-left font-medium">
                          {t.admin_providers_col_capabilities}
                        </th>
                        <th className="px-3 py-2.5 text-center font-medium">
                          {t.admin_providers_col_listed}
                        </th>
                        <th className="px-3 py-2.5 text-center font-medium">
                          {t.admin_providers_col_enabled}
                        </th>
                        <th className="px-3 py-2.5 text-center font-medium">
                          {t.admin_providers_col_pricing}
                        </th>
                        <th className="px-3 py-2.5 text-right font-medium">
                          {t.admin_providers_col_sort}
                        </th>
                        <th className="px-3 py-2.5 text-center font-medium">
                          {t.admin_providers_col_actions}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerModels.map((model) => (
                        <tr
                          key={model.id}
                          className={`border-t border-border ${model.enabled ? "" : "opacity-50"}`}
                        >
                          <td className="px-3 py-2">
                            <div className="text-text-primary">{model.label}</div>
                            <div className="font-mono text-[11px] text-text-muted">
                              {model.modelId}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-muted">
                            {KIND_LABEL_KEYS[model.kind]
                              ? t[KIND_LABEL_KEYS[model.kind]]
                              : model.kind}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-text-muted">
                            {capabilitiesSummary(model.capabilities)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={model.listed}
                              onChange={() => void toggle(model, "listed")}
                              className="h-4 w-4 accent-accent"
                              aria-label={t.admin_providers_col_listed}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={model.enabled}
                              onChange={() => void toggle(model, "enabled")}
                              className="h-4 w-4 accent-accent"
                              aria-label={t.admin_providers_col_enabled}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {model.priced ? (
                              <span className="text-[11px] text-emerald-500">
                                {t.admin_providers_priced}
                              </span>
                            ) : (
                              <span className="text-[11px] text-amber-500">
                                {t.admin_providers_unpriced}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-text-muted">
                            {model.sortOrder}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => setModelDialog({ open: true, provider, model })}
                              className="rounded-md p-1 text-text-muted transition hover:text-text-primary"
                              aria-label={t.admin_providers_edit_model}
                              title={t.admin_providers_edit_model}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => void removeModel(model)}
                              className="rounded-md p-1 text-text-muted transition hover:text-red-500"
                              aria-label={t.admin_models_delete}
                              title={t.admin_models_delete}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}

      <ProviderDialog
        open={providerDialog.open}
        provider={providerDialog.provider}
        onClose={() => setProviderDialog({ open: false, provider: null })}
        onSaved={() => void load()}
        t={t}
      />
      {modelDialog.provider ? (
        <ModelDialog
          open={modelDialog.open}
          provider={modelDialog.provider}
          model={modelDialog.model}
          onClose={() => setModelDialog({ open: false, provider: null, model: null })}
          onSaved={() => void load()}
          t={t}
        />
      ) : null}
    </div>
  );
}
