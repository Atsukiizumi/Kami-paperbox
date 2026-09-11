import { GET as getLogin, POST as postLogin } from "@/routes/api/login-browser";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 访客层（TD-20）：绑定 Pixiv/FANBOX 属内容面——凭据不进轮询快照（SEC-02），
// 只经 ?credentials=1 一次性发给发起登录的同一浏览器，服务端不落盘。
export const GET = withDataPlane(getLogin, { guest: true });
export const POST = withDataPlane(postLogin, { guest: true });
