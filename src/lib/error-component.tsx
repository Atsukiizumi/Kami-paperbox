import { TriangleAlert } from "lucide-react";
import { isAbortError } from "@/lib/abort";

export { isAbortError };

export function AppErrorComponent({ error }: { error: Error }) {
  if (isAbortError(error)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-sm text-muted">
        正在重新连接…
      </main>
    );
  }
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-bg text-fg"
      }
    >
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">出了点问题</h1>
      <p className="max-w-md text-sm break-words text-muted">
        {error.message || "请刷新页面再试。"}
      </p>
    </main>
  );
}
