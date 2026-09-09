/**
 * Local email/password sign-in (this app's Better Auth DB — not the broker).
 *
 * 作用：应用自己的账号体系（设置 → 账号 → 应用账号）。注册 / 登录走
 *      authClient.signUp.email / authClient.signIn.email，会话存在本机 PGLite。
 * 为什么：换浏览器 / 换设备时凭账号恢复设置和各图站 Cookie，不用再手动导备份。
 */
export const emailAndPasswordEnabled = true;
