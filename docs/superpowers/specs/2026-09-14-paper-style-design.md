# 纸感质感批 + 手绘风格 · 设计定稿

> 2026-09-14。demo 分支 `demo/paper-style`（/style-demo 演示页）经用户两轮验收拍板转正式；本文是正式实现的范围与契约。验收记录：整体「很棒」+ 两条批注（灯箱操作指引进设置说明 ✅ 已随 demo 实现；动效统一成一套语言 ✅）。

## 核心决策（用户拍板）

1. **手绘是可切换的风格**：`uiStyle: "clean" | "hand"` 设置项，默认 clean；手绘只做**标注层**（记号/字体/微歪/墨晕），控件形态两态同构。
2. **动效统一语言**：一条曲线 `--paper-ease: cubic-bezier(0.22,1,0.36,1)`（与主题圆形揭示同源）× 三档时长（160 微反馈 / 220 浮层 / 320 大场景）；只动 transform/opacity；`prefers-reduced-motion` 全归零。第三方组件（YARL/vaul）默认过渡一律覆盖校准。
3. 不引入任何带默认脸的组件库（AntD/MUI 不进）；取件只取无头/行为型。
4. 第一批（弹层精修/抽屉/日历/氛围层）+ 第二批（灯箱/分栏）全做。

## PR 拆分

### PR1 纸感基座（feat/paper-foundation）
- styles.css：`--paper-ease / --paper-dur-fast|mid|slow / --paper-shadow-1|2|3` token（阴影为暖墨非纯黑，附 inset 顶部一线纸边高光）；`kami-layer-in/out、kami-drop-in、kami-fade-in/out` 关键帧与工具类；全局细噪点纹理（body::after，feTurbulence data-uri，opacity .04，mix-blend overlay）；全局卷轴滚动条（token 派生色，双主题适配）；reduced-motion 登记。
- ui 层精修：dialog（浮起进场 + shadow-3）、dropdown-menu / select / tooltip（drop-in + shadow-1/2）；新增 `ui/popover.tsx`（含 Arrow）。
- 无新依赖。

### PR2 手绘风格切换（feat/paper-hand-style）
- settings store：`uiStyle` 字段（persist v10→v11 migrate，默认 "clean"）；备份导出白名单（backup.ts）与账号同步 settings 段自动携带（非敏感，plain 传输）。
- providers/app-shell 挂 `html[data-kami-style="hand"]`；设置页「外观」区加风格切换（双卡片开关）。
- 手绘层全局样式：霞鹜文楷（lxgw-wenkai-webfont，unicode-range 分片按需）用于 display 标题；.kami-slip 微歪边框；卡片 hover 墨晕 + 0.15° 歪斜；EmptySheet 涂鸦变体；DemoSection 式毛笔下划线用于分区标题。
- 新依赖：lxgw-wenkai-webfont。

### PR3 控件落地（feat/paper-controls）
- react-day-picker：Pixiv 榜单日期选择、纸匣按月筛选（纸感换皮变量集）。
- vaul：移动端设置分区 / 纸匣筛选面板 bottom sheet。
- YARL + Zoom：作品详情多 P 大图浏览（替换/增强现 lightbox），动效覆盖到 paper token；操作指引已在前置提交进设置说明区。
- react-resizable-panels（v4 API：Group/Panel/Separator，数字=像素字符串=百分比）：设置页侧栏可拖。
- 新依赖：react-day-picker / vaul / yet-another-react-lightbox / react-resizable-panels。

## 不变式

- 折角纸是记号不是装饰堆料；无紫无金光无 emoji。
- 动效只走合成线程；全部进 prefers-reduced-motion。
- demo 分支保留至全部 PR 合并后再删；/style-demo 演示页不进 main。
