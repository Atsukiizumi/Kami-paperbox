/**
 * /api/source 的错误分类（S7）。
 *
 * 上游侧失败（UpstreamError：网络 / 源站 5xx / 反爬 / 数据不可解析）回 502，
 * 用户态错误（需要登录、安全模式、参数不合法等）回 400。客户端只读 { error }
 * 正文，不依赖状态码，所以分类只影响可观测性与语义正确性。
 */
import { UpstreamError } from "./upstream/http.ts";

export type SourceErrorKind = "upstream" | "bad-request";

export function classifySourceError(err: unknown): {
  status: number;
  kind: SourceErrorKind;
  message: string;
} {
  const message = err instanceof Error && err.message ? err.message : "请求失败";
  // name 兜底：打包器若给路由与 upstream 各一份模块实例，instanceof 会失效
  const isUpstream =
    err instanceof UpstreamError || (err instanceof Error && err.name === "UpstreamError");
  const kind: SourceErrorKind = isUpstream ? "upstream" : "bad-request";
  return { status: kind === "upstream" ? 502 : 400, kind, message };
}
