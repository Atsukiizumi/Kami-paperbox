"use client";

/**
 * 设置「代理」页。
 *
 * 作用：查看 / 保存 / 探测 / 清除出站代理地址（写入本机 kami.config.json）。
 * 用法：设置分类「代理」渲染 ProxySection；自己拉 /api/proxy，不经 store。
 * 为什么：代理是机器级配置不是浏览器偏好，放服务端配置文件而非 localStorage。
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function sourceLabel(source: string): string {
  if (source === "saved") return "已保存在本机";
  if (source === "config") return "来自 kami.config.json";
  if (source === "env") return "来自环境变量";
  return "未使用";
}

export function ProxySection() {
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("none");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/proxy");
    const data = (await res.json()) as { url?: string; source?: string };
    setUrl(data.url ?? "");
    setSource(data.source ?? "none");
  }

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; url?: string; source?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error || "保存失败");
      setUrl(data.url ?? "");
      setSource(data.source ?? "saved");
      toast.success(data.url ? "代理已写入 kami.config.json，立即生效" : "已关闭自定义代理");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function probe() {
    setBusy(true);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ probe: true, url }),
      });
      const data = (await res.json()) as {
        error?: string;
        probe?: { ok?: boolean; message?: string };
      };
      if (!res.ok) throw new Error(data.error || "探测失败");
      if (data.probe?.ok) toast.success(data.probe.message || "代理可用");
      else toast.error(data.probe?.message || data.error || "代理不通");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "探测失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>网络代理</CardTitle>
        <CardDescription>
          拉取 Pixiv、FANBOX、图站和搜图时走这个地址。支持 http、https、socks5，例如
          127.0.0.1:7890 或 socks5://127.0.0.1:1080。点保存会写入本机 kami.config.json，重启后也还在。
          封面控流（同时拉几张图）在同一文件的 throttle.mediaConcurrency。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Label htmlFor="proxy-url">代理地址</Label>
        <Input
          id="proxy-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://127.0.0.1:7890"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-subtle">{sourceLabel(source)}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            保存代理
          </Button>
          <Button variant="secondary" onClick={() => void probe()} disabled={busy}>
            检测连通
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setUrl("");
              void (async () => {
                setBusy(true);
                try {
                  await fetch("/api/proxy", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ clear: true }),
                  });
                  setSource("none");
                  toast.success("已清除本机代理");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            清除
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
