/**
 * themes/_template/ 的自材料化内容（P2）。
 *
 * 作用：扫描时若模板缺失则写入——用户和 AI 的主题包起点。所有字段带注释，
 *      agent-prompt.md 写死全部校验约束（AI 照抄即可通过校验）。
 * 用法：theme-pack.server.ts 的 ensureTemplate() 消费；键 = 包内相对路径。
 * 为什么：模板放 themes/（应用数据目录）不放仓库——它就是「第一个主题包」
 *        的样品，跟着用户数据走。
 */

export const TEMPLATE_MANIFEST = `{
  "kamitheme": 1,
  "meta": {
    "name": "我的第一个主题",
    "author": "你的名字",
    "version": "0.1.0",
    "description": "把这段改成你的主题一句话介绍"
  },
  "palette": {
    "base": "washi",
    "overrides": {
      "accent": "#d8c9a8"
    }
  },
  "shell": {
    "form": "desk",
    "tweaks": { "contentWidth": "paper" }
  },
  "layout": {
    "slots": [
      { "span": 2, "items": ["browse-sheet"] },
      { "span": 1, "items": ["letters", "stack", "artist-wall"] },
      { "span": 3, "items": ["newspaper"] }
    ],
    "headerSlip": true
  }
}
`;

export const TEMPLATE_CSS = `/* 我的第一个主题 · theme.css
   只写质感层（纸纹、字体、圆角、阴影）——结构（侧栏/网格/槽位）由外壳与布局管。
   url() 里的路径必须出现在 kami-theme.json 的 assets 段，否则会被替换成 none。
   例：@font-face { font-family: "MyKami"; src: url(assets/my-font.woff2) format("woff2"); }
       html[data-kami-theme] .font-display { font-family: "MyKami", serif; }
*/
`;

export const TEMPLATE_AGENT_PROMPT = `# Kami 纸匣 · 主题包生成提示词（交给任意 AI）

把本提示词整段复制给 AI（Claude / ChatGPT / Grok 等），再附一句你想要的感觉，
让它产出一个主题包文件夹，把整个文件夹放进 themes/ 即可生效。

---

你是「Kami 纸匣」的主题包设计师。Kami 纸匣是一个本机图站浏览器，品牌是
日本纸工房（墨黑书案 + 宣纸），忌紫、金光、霓虹、emoji 堆砌。请根据用户的
一句话描述，产出以下三个文件（直接给完整文件内容，不要省略）：

1. kami-theme.json —— 严格按此 schema，多余键会被忽略、非法值会导致该段被跳过：
   - kamitheme: 1（固定）
   - meta: { name: 1~24 字, author, version, description }
   - palette（可选）: { base: 内置主题 id 之一, overrides: { 颜色键: "#hex 或 rgb()/oklch()" } }
     颜色键白名单：bg surface elevated fg muted subtle accent accentFg danger ok
   - shell（可选）: { form: "desk"|"rail"|"zen", tweaks: {...} }
     旋钮白名单——desk: contentWidth(paper|wide|full) topbarDensity(normal|compact)；
     rail: contentWidth iconSize(sm|md|lg) topbar(on|float)；zen: contentMargin(normal|tight) triggerSide(left|right)
   - layout（可选）: { slots: [{ span: 1|2|3, items: [模块id...] }], headerSlip: bool }
     模块 id：browse-sheet newspaper letters stack artist-wall
   - css（可选）: "theme.css"
   - assets（可选）: [{ id: "A-Za-z0-9_-", file: "包内路径" }]（≤32 项）
2. theme.css —— 只做质感层（≤64KB）：禁 @import；url() 只能引用 assets 声明的
   包内文件或小型 data: 图片；不要改布局结构（那是外壳/布局的事）。
3. 资材说明 —— 若需要字体/纸纹图片，列出文件名让用户自行放入 assets/（你无法
   生成二进制），并在 kami-theme.json 的 assets 段声明好。

配色建议基准：bg 接近 #0e0d0c~#171614 的深墨或 #f3ece0 的宣纸；accent 低饱和。
产出的 JSON 必须能通过 JSON.parse（不带注释、不带尾逗号）。

---

用户想要的感觉：「在这里写一句话，比如：雨夜读信的安静蓝黑」
`;

/** 模板文件集：键 = _template/ 内相对路径。 */
export const THEME_TEMPLATE_FILES: Readonly<Record<string, string>> = {
  "kami-theme.json": TEMPLATE_MANIFEST,
  "theme.css": TEMPLATE_CSS,
  "agent-prompt.md": TEMPLATE_AGENT_PROMPT,
  "assets/放字体和纸纹这里.txt": "素材文件夹。字体（woff2/woff/ttf/otf）与图片（png/jpg/webp/avif/svg）放这里，\n然后在 kami-theme.json 的 assets 段声明，css 里用 url(assets/文件名) 引用。\n单个文件 ≤ 2MB。\n",
};
