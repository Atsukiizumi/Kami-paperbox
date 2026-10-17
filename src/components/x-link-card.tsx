"use client";

/**
 * 画师页「X 关联」卡（X 账号关联 M5，R2/R3）。
 *
 * 作用：画师 ↔ X 账号关联的操作面——自动建议（pixiv 主页外链 social.twitter
 *      为主信号 + 昵称 @handle 尾巴为次级信号，双源去重）逐条采纳/忽略；
 *      手动录入三形态（@handle / 裸 handle / x.com 个人页 URL）；已关联态
 *      展示 handle 与来源、直达 X 预览（/x/{handle}，M6 起有真路由）、解除。
 * 用法：<XLinkCard authorId={profile.id} name={profile.name}
 *        socialTwitter={profile.social?.twitter} />，挂 user.$id 头像区之后。
 * 存储口径：xAssociations["pixiv:{authorId}"]（M4 设置段 v16 定式键）。「忽略」
 *      把 handle 记进该条目的 ignoredHandles（同 handle 不再提示，R2）；未关联
 *      时没有可挂的条目，就建一条 handle 自身也在 ignoredHandles 里的「仅忽略」
 *      记录——本卡把 handle ∈ 自己的 ignoredHandles 读作「无在用关联，只存忽略
 *      记忆」；随后采纳任何 handle 都会把被采纳者从 ignoredHandles 挪出（忽略
 *      记忆随条目转正保留）。M6 预览页等后来消费方读 xAssociations 时请沿用同
 *      一判据，别把仅忽略记录当正式关联。
 */
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/kami-link";
import { extractAuthorHandleTail } from "@/lib/author-name";
import { useSettings } from "@/lib/store";
import { parseXHandleInput } from "@/lib/x-settings";

/** 一条建议：handle（原样大小写）+ 双源标记（主页外链 / 昵称尾巴）。 */
type Suggestion = { handle: string; fromProfile: boolean; fromName: boolean };

/**
 * 汇总双源建议：social.twitter 是 M3 在 upstream 已解析好的 handle（此处仍走
 * 同一校验兜底），昵称尾巴由 extractAuthorHandleTail 回收；大小写不敏感去重，
 * 两源一致只留一条并双标。主页外链在前（信号强于昵称装饰）。
 */
function buildSuggestions(socialTwitter: string | undefined, authorName: string): Suggestion[] {
  const byKey = new Map<string, Suggestion>();
  const offer = (raw: string | undefined, fromProfile: boolean) => {
    const handle = parseXHandleInput(raw ?? "");
    if (!handle) return;
    const key = handle.toLowerCase();
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, fromName: true } : { handle, fromProfile, fromName: !fromProfile });
  };
  offer(socialTwitter, true);
  offer(extractAuthorHandleTail(authorName), false);
  return [...byKey.values()];
}

/** 手动录入行：三形态解析、内联报错、中文输入法组合态 Enter 不当提交。 */
function ManualEntry({
  value,
  error,
  onChange,
  onSubmit,
}: {
  value: string;
  error: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          aria-label="X handle"
          className="h-9"
          autoComplete="off"
          spellCheck={false}
          placeholder="@handle、x.com/handle 或裸 handle"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // isComposing：中文输入法组合态的 Enter 是上屏不是提交（P1 教训，
            // session-relay / vault-stats 同款守卫）
            if (e.key === "Process" || e.nativeEvent.isComposing) return;
            if (e.key === "Enter") onSubmit();
          }}
        />
        <Button size="sm" onClick={onSubmit}>
          关联
        </Button>
      </div>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

export function XLinkCard({
  authorId,
  name,
  socialTwitter,
}: {
  authorId: string;
  name: string;
  socialTwitter?: string;
}) {
  // M4 定式：画师页的关联键恒为 `pixiv:{authorId}`（authorKey 的 pixiv 特化）
  const assocKey = `pixiv:${authorId}`;
  // 读取对旧档容错：xAssociations 字段缺失（v15 迁移前的快照）时不炸，按无关联渲染
  const assoc = useSettings((s) => s.xAssociations?.[assocKey]);
  const setXAssociation = useSettings((s) => s.setXAssociation);
  const removeXAssociation = useSettings((s) => s.removeXAssociation);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);

  // handle ∈ 自己的 ignoredHandles = 「仅忽略」记录（见文件头），不算在用关联
  const linked =
    assoc && !(assoc.ignoredHandles ?? []).some((h) => h.toLowerCase() === assoc.handle.toLowerCase())
      ? assoc
      : undefined;

  const suggestions = useMemo(() => {
    if (linked) return [];
    const ignored = new Set((assoc?.ignoredHandles ?? []).map((h) => h.toLowerCase()));
    return buildSuggestions(socialTwitter, name).filter((s) => !ignored.has(s.handle.toLowerCase()));
  }, [linked, assoc, socialTwitter, name]);

  function adopt(handle: string, origin: "auto" | "manual") {
    const prev = assoc;
    setXAssociation(assocKey, {
      handle,
      origin,
      addedAt: Date.now(),
      // restId 是 handle 解析缓存，同 handle 转正时继承（换 handle 作废）
      ...(prev?.restId && prev.handle.toLowerCase() === handle.toLowerCase() ? { restId: prev.restId } : {}),
      // 采纳 = 把该 handle 从忽略记忆挪出；对其他候选的忽略随条目保留
      ...(prev?.ignoredHandles?.length
        ? { ignoredHandles: prev.ignoredHandles.filter((h) => h.toLowerCase() !== handle.toLowerCase()) }
        : {}),
    });
    setManual("");
    setManualError("");
    setEntryOpen(false);
    toast.success(`已关联 @${handle}，去 X 预览可挑图入队`);
  }

  function ignoreSuggestion(handle: string) {
    const ignored = [
      ...new Set([...(assoc?.ignoredHandles ?? []).map((h) => h.toLowerCase()), handle.toLowerCase()]),
    ];
    setXAssociation(
      assocKey,
      // 已有条目（含仅忽略记录）只追加 ignoredHandles；没有条目就建仅忽略记录
      assoc ? { ...assoc, ignoredHandles: ignored } : { handle, origin: "auto", addedAt: Date.now(), ignoredHandles: ignored },
    );
    toast.success(`已忽略 @${handle}，不会再提示`);
  }

  function submitManual() {
    const handle = parseXHandleInput(manual);
    if (!handle) {
      setManualError("没认出这是 X handle——试试 @名字、x.com/名字 或直接名字（≤15 位字母数字下划线）");
      return;
    }
    adopt(handle, "manual");
  }

  // 已关联：handle + 来源标记 + 直达 X 预览 + 解除（restId 未解析不阻塞展示）
  if (linked) {
    return (
      <section aria-label="X 关联" className="rounded-xl bg-surface p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-sm font-medium text-fg">X 关联</h2>
          <span className="text-sm text-fg">@{linked.handle}</span>
          <Badge>{linked.origin === "auto" ? "自动发现" : "手动"}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to={`/x/${linked.handle}`} resetScroll={false}>
                去 X 预览
              </Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => {
              removeXAssociation(assocKey);
              toast.success("已解除 X 关联");
            }}>
              解除
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // 未关联 + 有建议：列表（采纳/忽略）+ 手动录入
  if (suggestions.length > 0) {
    return (
      <section aria-label="X 关联" className="space-y-3 rounded-xl bg-surface p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-medium text-fg">X 关联</h2>
          <p className="text-xs text-muted">这位画师可能是这些 X 账号——采纳后可在纸匣里预览 TA 的 X 图片</p>
        </div>
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li key={s.handle.toLowerCase()} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm text-fg">@{s.handle}</span>
              <Badge>{s.fromProfile && s.fromName ? "主页外链+昵称" : s.fromProfile ? "主页外链" : "昵称"}</Badge>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => adopt(s.handle, "auto")}>
                  采纳
                </Button>
                <Button size="sm" variant="ghost" onClick={() => ignoreSuggestion(s.handle)}>
                  忽略
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <ManualEntry
          value={manual}
          error={manualError}
          onChange={(v) => {
            setManual(v);
            setManualError("");
          }}
          onSubmit={submitManual}
        />
      </section>
    );
  }

  // 未关联 + 无建议：折叠成一行入口，点开才露手动录入（不喧宾夺主）
  if (!entryOpen) {
    return (
      <section aria-label="X 关联">
        <Button size="sm" variant="ghost" onClick={() => setEntryOpen(true)}>
          <Plus className="size-4" />
          关联 X 账号
        </Button>
      </section>
    );
  }
  return (
    <section aria-label="X 关联" className="space-y-3 rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3">
        <h2 className="text-sm font-medium text-fg">X 关联</h2>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEntryOpen(false)}>
          收起
        </Button>
      </div>
      <ManualEntry
        value={manual}
        error={manualError}
        onChange={(v) => {
          setManual(v);
          setManualError("");
        }}
        onSubmit={submitManual}
      />
    </section>
  );
}
