"use client";

/**
 * 设置 → 存储「云备份」卡。
 *
 * 作用：连接云存储（WebDAV / S3 兼容二选一，测试连接通过才落盘）→ 显式打开
 *      定时开关（连接 ≠ 开启，默认关）→ 看运行态（最近成功/失败、首轮进度、
 *      快照列表、孤儿计数）→ 立即备份 / 断开连接。
 * 用法：<CloudBackupCard onChanged={refetch} />；存储分区渲染。
 * 为什么：云是唯一备份闸门（未连接没有备份）；凭据只进服务端，这里只拿掩码。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { cn, formatBytes } from "@/lib/utils";
import { DEFAULT_REMOTE_DIR, cloudKindLabel, type CloudKind } from "@/lib/storage/cloud-backup/types";

type CloudStatus = {
  ok: boolean;
  connected: boolean;
  target: { kind: CloudKind; host: string; remoteDir: string } | null;
  config: { enabled: boolean; intervalHours: number; keep: number } | null;
  status: {
    running: boolean;
    phase: string;
    done: number;
    total: number;
    bytesDone: number;
    lastOkAt: number | null;
    lastErrorAt: number | null;
    lastError: string | null;
    snapshots: string[];
    orphans: number;
  };
  unsupported: string | null;
};

const PHASE_LABEL: Record<string, string> = {
  idle: "空闲",
  catalog: "打包目录快照",
  files: "上传像素",
  manifest: "写回清单",
};

function formatDate(at: number | null): string {
  if (!at) return "从未";
  const d = new Date(at);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EMPTY_FORM = {
  url: "",
  username: "",
  password: "",
  endpoint: "",
  region: "",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  remoteDir: "",
};

export function CloudBackupCard({ onStatus }: { onStatus?: (lastOkAt: number | null) => void }) {
  const [data, setData] = useState<CloudStatus | null>(null);
  const [kind, setKind] = useState<CloudKind>("webdav");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<"test" | "connect" | "config" | "run" | "disconnect" | null>(null);
  const [armDisconnect, setArmDisconnect] = useState(false);
  const pollRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/cloud-backup", { cache: "no-store" });
      const body = (await res.json()) as CloudStatus;
      if (body.ok) {
        setData(body);
        onStatus?.(body.status?.lastOkAt ?? null);
      }
    } catch {
      /* 服务端不可达：卡上保持未连接态 */
    }
  }, [onStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 备份进行中每 5 秒轮询进度；停了自动停表
  useEffect(() => {
    if (!data?.status.running) return;
    pollRef.current = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(pollRef.current);
  }, [data?.status.running, refresh]);

  function formTarget(): Record<string, unknown> {
    const remoteDir = form.remoteDir.trim() || DEFAULT_REMOTE_DIR;
    return kind === "webdav"
      ? { kind, url: form.url.trim(), username: form.username.trim(), password: form.password, remoteDir }
      : {
          kind,
          endpoint: form.endpoint.trim(),
          region: form.region.trim() || "auto",
          bucket: form.bucket.trim(),
          accessKeyId: form.accessKeyId.trim(),
          secretAccessKey: form.secretAccessKey,
          remoteDir,
        };
  }

  async function call(method: string, body?: unknown) {
    const res = await fetch("/api/vault/cloud-backup", {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as CloudStatus & { ok: boolean; error?: string };
  }

  async function act(kind_: "test" | "connect" | "config" | "run" | "disconnect", body?: unknown) {
    setBusy(kind_);
    try {
      const method = kind_ === "disconnect" ? "DELETE" : kind_ === "run" || kind_ === "test" ? "POST" : "PUT";
      const res = await call(method, body);
      if (!res.ok) {
        toast.error(res.error ?? "没做成");
        if (res.error) await refresh();
        return;
      }
      if (kind_ === "test") toast.success("连接成功");
      if (kind_ === "connect") toast.success("已连接。定时备份默认关闭，确认下面的开关后再跑");
      if (kind_ === "config") toast.success("配置已保存");
      if (kind_ === "run") toast.success("备份已开始，进展看这张卡");
      if (kind_ === "disconnect") toast.success("已断开连接（云端数据没有动）");
      if (res.ok && "connected" in res) setData(res);
      else await refresh();
      if (kind_ === "run" || kind_ === "disconnect") await refresh();
      if (kind_ === "connect" || kind_ === "config") onStatus?.(res.status?.lastOkAt ?? null);
    } catch {
      toast.error("网络不对，稍后再试");
    } finally {
      setBusy(null);
      setArmDisconnect(false);
    }
  }

  const s = data?.status;
  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>云备份</CardTitle>
        <CardDescription>
          连上自己的云盘（WebDAV 或 S3 兼容），定时把纸匣目录和全部像素增量传上去。未连接不备份；连上后定时也默认关闭，要你亲手打开。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data?.unsupported ? <p className="text-sm text-subtle">{data.unsupported}</p> : null}

        {!data?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {(["webdav", "s3"] as CloudKind[]).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={kind === k ? "secondary" : "ghost"}
                  onClick={() => setKind(k)}
                >
                  {cloudKindLabel(k)}
                </Button>
              ))}
            </div>
            {kind === "webdav" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="cb-url">WebDAV 地址</Label>
                  <Input id="cb-url" placeholder="https://dav.jianguoyun.com/dav/" {...field("url")} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="cb-user">账号</Label>
                    <Input id="cb-user" autoComplete="off" {...field("username")} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="cb-pass">密码 / 应用密码</Label>
                    <Input id="cb-pass" type="password" autoComplete="new-password" {...field("password")} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="cb-endpoint">兼容端点</Label>
                  <Input id="cb-endpoint" placeholder="https://<account>.r2.cloudflarestorage.com" {...field("endpoint")} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="cb-bucket">Bucket</Label>
                    <Input id="cb-bucket" autoComplete="off" {...field("bucket")} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="cb-region">Region（R2 用 auto）</Label>
                    <Input id="cb-region" placeholder="auto" autoComplete="off" {...field("region")} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="cb-ak">Access Key ID</Label>
                    <Input id="cb-ak" autoComplete="off" {...field("accessKeyId")} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="cb-sk">Secret Access Key</Label>
                    <Input id="cb-sk" type="password" autoComplete="new-password" {...field("secretAccessKey")} />
                  </div>
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label htmlFor="cb-dir">备份目录（可选）</Label>
              <Input id="cb-dir" placeholder={DEFAULT_REMOTE_DIR} {...field("remoteDir")} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void act("test", { target: formTarget() })}>
                {busy === "test" ? "测试中…" : "测试连接"}
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => void act("connect", { target: formTarget() })}>
                {busy === "connect" ? "连接中…" : "连接"}
              </Button>
            </div>
            <p className="text-xs text-subtle">凭据只存在服务端 .data 里，浏览器和备份文件里都不会出现。</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  {data.target ? `${cloudKindLabel(data.target.kind)} · ${data.target.host}` : "已连接"}
                </p>
                <p className="mt-0.5 text-xs text-subtle">
                  云端目录 {data.target?.remoteDir} · 最近成功 {formatDate(s?.lastOkAt ?? null)}
                  {s?.lastErrorAt ? ` · 上次失败：${s.lastError}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy !== null}
                onClick={() => {
                  if (!armDisconnect) {
                    setArmDisconnect(true);
                    return;
                  }
                  void act("disconnect");
                }}
                onBlur={() => setArmDisconnect(false)}
              >
                {armDisconnect ? "再点一次，断开连接" : "断开连接"}
              </Button>
            </div>

            {s?.running ? (
              <div className="rounded-xl bg-bg p-3 text-sm">
                <p className="font-medium text-fg">{PHASE_LABEL[s.phase] ?? s.phase}…</p>
                {s.total > 0 ? (
                  <p className="mt-1 text-xs text-subtle">
                    {s.done}/{s.total} 个文件 · 已传 {formatBytes(s.bytesDone)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg p-3">
              <div className="flex items-center gap-3">
                <Switch
                  id="cb-enabled"
                  checked={data.config?.enabled ?? false}
                  disabled={busy !== null}
                  onCheckedChange={(checked) => void act("config", { config: { ...(data.config ?? {}), enabled: checked } })}
                />
                <div>
                  <Label htmlFor="cb-enabled" className="cursor-pointer text-sm font-medium text-fg">
                    定时备份{data.config?.enabled ? "已开启" : "已关闭"}
                  </Label>
                  <p className="mt-0.5 text-xs text-subtle">每 {data.config?.intervalHours ?? 24} 小时一轮，开机后会补上错过的</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(data.config?.intervalHours ?? 24)}
                  onValueChange={(v) => void act("config", { config: { ...(data.config ?? {}), intervalHours: Number(v) } })}
                >
                  <SelectTrigger className="h-8 w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[6, 12, 24, 72, 168].map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        每 {h >= 24 ? `${h / 24} 天` : `${h} 小时`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(data.config?.keep ?? 14)}
                  onValueChange={(v) => void act("config", { config: { ...(data.config ?? {}), keep: Number(v) } })}
                >
                  <SelectTrigger className="h-8 w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[4, 7, 14, 30, 60].map((k) => (
                      <SelectItem key={k} value={String(k)}>
                        留 {k} 份
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={busy !== null || s?.running} onClick={() => void act("run")}>
                {s?.running ? "备份进行中…" : busy === "run" ? "启动中…" : "立即备份"}
              </Button>
              {s && s.orphans > 0 ? (
                <span className="text-xs text-subtle">云端有 {s.orphans} 个本地已不存在的文件（保留不动）</span>
              ) : null}
              {s && s.snapshots.length > 0 ? (
                <span className={cn("text-xs text-subtle")}>快照 {s.snapshots.length} 份 · 最新 {s.snapshots[0]}</span>
              ) : null}
            </div>
            <p className="text-xs text-subtle">
              恢复办法见 docs/storage.md：装好应用后用恢复脚本把云端目录拉回来即可。
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
