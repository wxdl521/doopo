import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Users, Building2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import {
  getAdminCreditRecipients,
  getAdminCreditTransactions,
  grantAdminCredits,
  type AdminCreditRecipient,
  type AdminCreditTransaction,
} from "@/lib/adminCredits.functions";
import {
  getAdminUserStatuses,
  getTeamOwnerIds,
  type AdminUserStatus,
} from "@/lib/adminUsers.functions";
import AdminUserActionsDialog, {
  type AdminUserAction,
  type AdminUserTarget,
} from "@/components/admin/AdminUserActionsDialog";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/admin/credits")({
  component: AdminCredits,
});

const PAGE_SIZE = 10;

function AdminCredits() {
  const { t } = useLanguage();
  const callRecipients = useServerFn(getAdminCreditRecipients);
  const callGrant = useServerFn(grantAdminCredits);
  const callStatuses = useServerFn(getAdminUserStatuses);
  const callTeamOwners = useServerFn(getTeamOwnerIds);
  const [kind, setKind] = useState<"user" | "team">("user");
  const [page, setPage] = useState(1);
  const [recipients, setRecipients] = useState<AdminCreditRecipient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminCreditRecipient | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [ownerByTeam, setOwnerByTeam] = useState<Record<string, string>>({});
  const [statusByUser, setStatusByUser] = useState<Record<string, AdminUserStatus>>({});
  const [userAction, setUserAction] = useState<{
    action: AdminUserAction;
    target: AdminUserTarget;
  } | null>(null);
  // 2026/08:积分消耗明细（项目维度）——独立筛选与分页,与上方用户搜索并存
  const callTransactions = useServerFn(getAdminCreditTransactions);
  const [txnProjectInput, setTxnProjectInput] = useState("");
  const [txnProject, setTxnProject] = useState("");
  const [txnPage, setTxnPage] = useState(1);
  const [transactions, setTransactions] = useState<AdminCreditTransaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [txnHasProjectColumns, setTxnHasProjectColumns] = useState(true);

  const loadTransactions = useCallback(async () => {
    setTxnLoading(true);
    const result: any = await callTransactions({
      data: {
        page: txnPage,
        pageSize: 20,
        projectName: txnProject,
        // 左侧选中用户时联动过滤其流水（团队选中不按 owner 过滤,保持简单）
        userId: kind === "user" ? selected?.id : undefined,
      },
    });
    setTxnLoading(false);
    if (result?.error) {
      toast.error(result.error);
      setTransactions([]);
      return;
    }
    setTransactions(result?.transactions ?? []);
    setTxnHasProjectColumns(result?.hasProjectColumns !== false);
  }, [callTransactions, txnPage, txnProject, kind, selected]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const loadRecipients = useCallback(async () => {
    setLoading(true);
    const result: any = await callRecipients({
      data: { kind, page, pageSize: PAGE_SIZE, query },
    });
    setLoading(false);
    if (result?.error) {
      toast.error(result.error);
      setRecipients([]);
      setTotal(0);
      return;
    }
    const rows: AdminCreditRecipient[] = result?.recipients ?? [];
    setRecipients(rows);
    setTotal(result?.total ?? 0);
    void loadStatusesRef.current?.(rows, kind);
  }, [callRecipients, kind, page, query]);

  const loadStatuses = useCallback(
    async (rows: AdminCreditRecipient[], currentKind: "user" | "team") => {
      if (rows.length === 0) {
        setStatusByUser({});
        setOwnerByTeam({});
        return;
      }

      let userIds: string[] = [];
      if (currentKind === "user") {
        userIds = rows.map((row) => row.id);
        setOwnerByTeam({});
      } else {
        const ownerResult: any = await callTeamOwners({
          data: { teamIds: rows.map((row) => row.id) },
        });
        const map: Record<string, string> = {};
        for (const item of ownerResult?.owners ?? []) map[item.teamId] = item.ownerId;
        setOwnerByTeam(map);
        userIds = Object.values(map);
      }

      if (userIds.length === 0) {
        setStatusByUser({});
        return;
      }
      const statusResult: any = await callStatuses({ data: { userIds } });
      const statusMap: Record<string, AdminUserStatus> = {};
      for (const item of statusResult?.statuses ?? []) statusMap[item.id] = item;
      setStatusByUser(statusMap);
    },
    [callStatuses, callTeamOwners],
  );

  const loadStatusesRef = useRef(loadStatuses);
  loadStatusesRef.current = loadStatuses;

  useEffect(() => {
    setSelected(null);
    setAmount("");
    void loadRecipients();
  }, [loadRecipients]);

  const switchKind = (nextKind: "user" | "team") => {
    setKind(nextKind);
    setPage(1);
  };

  const submitSearch = () => {
    setPage(1);
    setQuery(searchInput.trim());
  };

  const grant = async () => {
    const numericAmount = Number(amount);
    if (!selected) {
      toast.error(t.admin_credits_choose_target);
      return;
    }
    if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      toast.error(t.admin_credits_amount_error);
      return;
    }

    setSubmitting(true);
    const result: any = await callGrant({
      data: {
        kind,
        targetId: selected.id,
        amount: numericAmount,
        description: description.trim() || undefined,
      },
    });
    setSubmitting(false);

    if (!result?.ok) {
      toast.error(result?.error || t.admin_credits_grant_error);
      return;
    }

    toast.success(
      t.admin_credits_grant_success.replace("{amount}", numericAmount.toLocaleString()),
    );
    setAmount("");
    setDescription("");
    await loadRecipients();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoNext = recipients.length === PAGE_SIZE && (total === 0 || page < totalPages);

  return (
    <div className="space-y-6">
      <PageHeader title={t.admin_credits_title} subtitle={t.admin_credits_sub} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-2">
                <button
                  onClick={() => switchKind("user")}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    kind === "user"
                      ? "bg-accent text-white"
                      : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Users size={15} />
                  {t.admin_credits_users}
                </button>
                <button
                  onClick={() => switchKind("team")}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    kind === "team"
                      ? "bg-accent text-white"
                      : "bg-bg-elevated text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <Building2 size={15} />
                  {t.admin_credits_teams}
                </button>
              </div>
              <div className="flex min-w-[220px] flex-1 gap-2">
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && submitSearch()}
                  placeholder={t.admin_credits_search_placeholder}
                  aria-label={t.admin_credits_search}
                />
                <button
                  onClick={submitSearch}
                  className="btn-ghost shrink-0 !px-3"
                  aria-label={t.admin_credits_search}
                >
                  <Search size={16} />
                </button>
              </div>
            </div>
            <p className="text-sm text-text-muted">
              {total > 0 ? t.admin_credits_total.replace("{count}", total.toLocaleString()) : ""}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated/60 text-text-muted">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">{t.admin_credits_col_target}</th>
                  <th className="px-5 py-3 text-right font-medium">
                    {t.admin_credits_col_balance}
                  </th>
                  <th className="px-5 py-3 text-left font-medium">{t.admin_col_created}</th>
                  <th className="px-5 py-3 text-left font-medium">{t.admin_user_col_status}</th>
                  <th className="px-5 py-3 text-right font-medium">{t.admin_user_col_actions}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-text-muted">
                      {t.admin_credits_loading}
                    </td>
                  </tr>
                ) : recipients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-text-muted">
                      {t.admin_credits_empty}
                    </td>
                  </tr>
                ) : (
                  recipients.map((recipient) => {
                    const accountId =
                      kind === "user" ? recipient.id : (ownerByTeam[recipient.id] ?? null);
                    const status = accountId ? statusByUser[accountId] : undefined;
                    return (
                    <tr
                      key={recipient.id}
                      onClick={() => setSelected(recipient)}
                      className={`cursor-pointer border-t border-border transition-colors hover:bg-bg-elevated/70 ${
                        selected?.id === recipient.id ? "bg-accent-dim" : ""
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium text-text-primary">{recipient.name}</div>
                        {recipient.email && (
                          <div className="mt-0.5 text-xs text-text-muted">{recipient.email}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-medium">
                        {recipient.balance.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-text-muted">
                        {new Date(recipient.createdAt).toLocaleDateString()}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        {!status ? (
                          <span className="text-text-muted">{t.admin_user_status_unknown}</span>
                        ) : (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              status.banned
                                ? "bg-destructive/10 text-destructive"
                                : "bg-emerald-500/10 text-emerald-600"
                            }`}
                          >
                            {status.banned
                              ? t.admin_user_status_banned
                              : t.admin_user_status_active}
                          </span>
                        )}
                      </td>
                      <td
                        className="whitespace-nowrap px-5 py-3 text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={!accountId}
                            onClick={() =>
                              accountId &&
                              setUserAction({
                                action: "reset",
                                target: {
                                  userId: accountId,
                                  name: recipient.name,
                                  email: recipient.email ?? null,
                                },
                              })
                            }
                            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg-elevated disabled:opacity-40"
                          >
                            {t.admin_user_reset_password}
                          </button>
                          <button
                            type="button"
                            disabled={!accountId || !status}
                            onClick={() =>
                              accountId &&
                              status &&
                              setUserAction({
                                action: status.banned ? "enable" : "disable",
                                target: {
                                  userId: accountId,
                                  name: recipient.name,
                                  email: recipient.email ?? null,
                                },
                              })
                            }
                            className={`rounded-md border px-2.5 py-1 text-xs disabled:opacity-40 ${
                              status?.banned
                                ? "border-border hover:bg-bg-elevated"
                                : "border-destructive/40 text-destructive hover:bg-destructive/10"
                            }`}
                          >
                            {status?.banned ? t.admin_user_enable : t.admin_user_disable}
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            <span className="text-xs text-text-muted">
              {t.admin_credits_page
                .replace("{page}", String(page))
                .replace("{total}", String(totalPages))}
            </span>
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1 || loading}
              className="rounded-md border border-border p-1.5 text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t.acc_credits_prev}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((current) => current + 1)}
              disabled={!canGoNext || loading}
              className="rounded-md border border-border p-1.5 text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t.acc_credits_next}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </section>

        <aside className="panel h-fit p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-dim text-accent">
              <Coins size={20} />
            </span>
            <div>
              <h2 className="font-display font-bold">{t.admin_credits_grant_title}</h2>
              <p className="text-xs text-text-muted">{t.admin_credits_grant_hint}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t.admin_credits_selected}</label>
              <div className="min-h-10 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-secondary">
                {selected ? (
                  <>
                    <div>{selected.name}</div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {selected.email
                        ? selected.kind === "team"
                          ? t.admin_credits_team_owner.replace("{email}", selected.email)
                          : t.admin_credits_email.replace("{email}", selected.email)
                        : t.admin_credits_no_email}
                    </div>
                  </>
                ) : (
                  t.admin_credits_choose_target
                )}
              </div>
            </div>
            <div>
              <label htmlFor="credit-amount" className="mb-1.5 block text-sm font-medium">
                {t.admin_credits_amount}
              </label>
              <Input
                id="credit-amount"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="1000"
              />
            </div>
            <div>
              <label htmlFor="credit-note" className="mb-1.5 block text-sm font-medium">
                {t.admin_credits_note}
              </label>
              <Input
                id="credit-note"
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t.admin_credits_note_placeholder}
              />
            </div>
            <button
              onClick={() => void grant()}
              disabled={!selected || submitting}
              className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t.admin_credits_granting : t.admin_credits_grant}
            </button>
          </div>
        </aside>
      </div>

      <AdminUserActionsDialog
        open={!!userAction}
        action={userAction?.action ?? "reset"}
        target={userAction?.target ?? null}
        onClose={() => setUserAction(null)}
        onSuccess={() => void loadRecipients()}
      />

      {/* 2026/08:积分消耗明细（按项目名称维度查询） */}
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display font-bold">{t.admin_credits_txn_title}</h2>
          <div className="flex min-w-[240px] gap-2">
            <Input
              value={txnProjectInput}
              onChange={(event) => setTxnProjectInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setTxnPage(1);
                  setTxnProject(txnProjectInput.trim());
                }
              }}
              placeholder={t.admin_credits_txn_project_placeholder}
              aria-label={t.admin_credits_txn_col_project}
            />
            <button
              onClick={() => {
                setTxnPage(1);
                setTxnProject(txnProjectInput.trim());
              }}
              className="btn-ghost shrink-0 !px-3"
              aria-label={t.admin_credits_search}
            >
              <Search size={16} />
            </button>
          </div>
        </div>
        {!txnHasProjectColumns && (
          <div className="border-b border-amber-500/40 bg-amber-500/10 px-5 py-2 text-xs text-amber-600">
            {t.admin_credits_txn_no_columns}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated/60 text-text-muted">
              <tr>
                <th className="px-5 py-3 text-left font-medium">
                  {t.admin_credits_txn_col_time}
                </th>
                <th className="px-5 py-3 text-left font-medium">
                  {t.admin_credits_txn_col_user}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t.admin_credits_txn_col_amount}
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  {t.admin_credits_txn_col_balance}
                </th>
                <th className="px-5 py-3 text-left font-medium">
                  {t.admin_credits_txn_col_model}
                </th>
                <th className="px-5 py-3 text-left font-medium">
                  {t.admin_credits_txn_col_project}
                </th>
                <th className="px-5 py-3 text-left font-medium">
                  {t.admin_credits_txn_col_desc}
                </th>
              </tr>
            </thead>
            <tbody>
              {txnLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-text-muted">
                    {t.admin_credits_loading}
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-text-muted">
                    {t.admin_credits_txn_empty}
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr key={txn.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-5 py-2.5 text-text-muted">
                      {new Date(txn.createdAt).toLocaleString()}
                    </td>
                    <td className="max-w-40 truncate px-5 py-2.5 font-mono text-xs text-text-muted">
                      {txn.userId.slice(0, 8)}…
                    </td>
                    <td
                      className={`whitespace-nowrap px-5 py-2.5 text-right font-mono font-medium ${
                        txn.amount < 0 ? "text-rose-500" : "text-emerald-600"
                      }`}
                    >
                      {txn.amount > 0 ? `+${txn.amount.toLocaleString()}` : txn.amount.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono text-text-secondary">
                      {txn.balanceAfter == null ? "-" : txn.balanceAfter.toLocaleString()}
                    </td>
                    <td className="max-w-48 truncate px-5 py-2.5 text-text-muted">
                      {txn.model ?? "-"}
                    </td>
                    <td className="max-w-40 truncate px-5 py-2.5 text-text-secondary">
                      {txn.projectName ?? "-"}
                    </td>
                    <td className="max-w-64 truncate px-5 py-2.5 text-text-muted">
                      {txn.description ?? "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <button
            onClick={() => setTxnPage((current) => Math.max(1, current - 1))}
            disabled={txnPage === 1 || txnLoading}
            className="rounded-md border border-border p-1.5 text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t.acc_credits_prev}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-text-muted">{txnPage}</span>
          <button
            onClick={() => setTxnPage((current) => current + 1)}
            disabled={transactions.length < 20 || txnLoading}
            className="rounded-md border border-border p-1.5 text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t.acc_credits_next}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
