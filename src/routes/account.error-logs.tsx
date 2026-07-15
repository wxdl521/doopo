import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listMyGenerationErrors } from "@/lib/errorLogs.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/account/error-logs")({
  head: () => ({ meta: [{ title: "调用错误日志 — Doopoo" }] }),
  component: ErrorLogsPage,
});

type Row = {
  id: string;
  kind: "image" | "video";
  provider: string;
  model: string | null;
  status: number | null;
  duration_ms: number | null;
  request_payload: unknown;
  response_body: string | null;
  error_message: string | null;
  created_at: string;
};

function ErrorLogsPage() {
  const list = useServerFn(listMyGenerationErrors);
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const q = useQuery({
    queryKey: ["generation-error-logs", kind],
    queryFn: () => list({ data: { kind, limit: 100 } }),
    refetchOnWindowFocus: false,
  });
  const rows: Row[] = (q.data?.rows as Row[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">调用错误日志</h1>
          <p className="text-sm text-muted-foreground">
            记录最近 100 条图片 / 视频生成失败的请求 payload 与上游响应,便于排查 400 / 超时。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "image", "video"] as const).map((k) => (
            <Button
              key={k}
              variant={kind === k ? "default" : "outline"}
              size="sm"
              onClick={() => setKind(k)}
            >
              {k === "all" ? "全部" : k === "image" ? "图片" : "视频"}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">加载中…</div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center border rounded-lg">
          暂无失败日志。
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">时间</th>
                <th className="text-left px-3 py-2">类型</th>
                <th className="text-left px-3 py-2">渠道</th>
                <th className="text-left px-3 py-2">模型</th>
                <th className="text-left px-3 py-2">状态</th>
                <th className="text-left px-3 py-2">耗时</th>
                <th className="text-left px-3 py-2">错误</th>
                <th className="text-left px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = !!expanded[r.id];
                return (
                  <>
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setExpanded((s) => ({ ...s, [r.id]: !isOpen }))}
                          className="text-muted-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={r.kind === "video" ? "default" : "secondary"}>
                          {r.kind === "video" ? "视频" : "图片"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{r.provider}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.model || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.status ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.duration_ms != null ? `${r.duration_ms}ms` : "-"}
                      </td>
                      <td className="px-3 py-2 max-w-md truncate text-destructive">
                        {r.error_message || "-"}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(r, null, 2));
                          }}
                          title="复制这条日志的 JSON"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + "-detail"} className="border-t bg-muted/20">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">
                                请求 payload
                              </div>
                              <pre className="text-xs bg-background border rounded p-2 max-h-80 overflow-auto">
                                {JSON.stringify(r.request_payload, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">
                                上游响应 / 错误
                              </div>
                              <pre className="text-xs bg-background border rounded p-2 max-h-80 overflow-auto whitespace-pre-wrap">
                                {r.response_body || r.error_message || "(空)"}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}