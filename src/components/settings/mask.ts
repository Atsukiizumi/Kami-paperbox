/**
 * Cookie 脱敏文案（纯函数）。
 *
 * 作用：账号分区里已保存 Cookie 的展示文案——不出原值，只露尾 4 位。
 * 用法：settings/account.tsx 渲染；同目录 .test.tsx 锁定文案。
 * 为什么：纯函数独立成文件是本仓库的 react-refresh 洁癖约定（route-shape 同款），
 *        组件文件只导出组件。
 */
export function mask(value: string): string {
  if (!value) return "未填写";
  if (value.length <= 6) return "已保存";
  return `已保存 · …${value.slice(-4)}`;
}
