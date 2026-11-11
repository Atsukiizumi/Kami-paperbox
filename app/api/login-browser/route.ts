import { GET as getLogin, POST as postLogin } from "@/routes/api/login-browser";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 凭据不进轮询快照（SEC-02），只经 ?credentials=1 一次性发给发起登录的
// 同一浏览器，服务端不落盘。账号开启时必须有应用会话：未登录不能在这台
// 机器上拉起浏览器。账号关闭时仍由局域网令牌把关。
export const GET = withDataPlane(getLogin);
export const POST = withDataPlane(postLogin);
