# Kami 纸匣丝滑动效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有浏览、预览、入队和灯箱路径上实现连续、可中断、真正可关停的纸感动效。

**Architecture:** 以现有 CSS token 和 WAAPI 为基础，增加一个无 store 依赖的动效生命周期模块，由 ThemeProvider 接入 `motionEnabled`。保留拼版算法与业务状态，将几何重排、卡片 hover、图片揭示和手势变换分配到各自的 DOM 层。所有装饰动画都可以立即完成或取消，业务操作不等待动画。

**Tech Stack:** 现有 Next.js App Router、React 19、Tailwind 4、Radix、Zustand、Web Animations API；node:test / RTL / Playwright。Node >=22，包管理器以 `package.json` 的 `pnpm@10.34.7` 为准；无新运行时依赖。

**Spec:** [动效设计与分阶段计划](../specs/2026-10-25-motion-polish-design.md)。先读此设计，再执行本计划。用户确认了动效方向；本文件是实施前的交付，不代表已开始实现。

## Global Constraints

- 动效方向：「轻拿、展开、归位」。沿用墨黑书案、宣纸、现有字体和排版。
- UI 动效只由应用内 `motionEnabled` / `html[data-motion]` 控制，不跟随系统 `prefers-reduced-motion`。
- 保留现有 token：`--motion-micro: 80ms`、`--motion-quick: 150ms`、`--motion-layer: 220ms`、`--motion-fast: 250ms`、`--motion-slow: 400ms`、`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`。
- 按下 80ms / 松开 150ms；卡片 hover 150ms、轻抬 2–3px；弹层展开 220ms / 收起 150ms；网格重排和预览 250ms；图片淡入 150ms；飞纸 400ms。只允许局部 ±30ms 的实机校准。
- left/top/width/height 允许一次设置为最终几何，不允许逐帧补间；临时 `will-change` 结束后释放。
- 只控制自己登记的 UI 动画；不能全局取消媒体或第三方动画。动效关闭不暂停 GIF / Ugoira 内容，不妨碍直接拖拽和捏合。
- 关闭动画只结束补间，终态由当前业务 `open` / 选中状态决定；正在展开且 `open=true` 的灯箱要保持打开，不能把开关理解成关闭所有浮层。
- 保留浏览页挂载、滚动位置、预热、媒体并发车道、重试、队列语义和用户凭据边界；持久化版本不变。
- `packJustified` 和纸匣 CSS 列瀑布流保持原有职责；不扩展到跨路由共享元素转场或全站滚动接管。
- 文件头注释写清作用 / 用法 / 为什么。正式每批提交更新 CHANGELOG；规划和示意阶段不改用户可见行为。
- 不将 `.superpowers/`、`.trellis/` 或真实 Cookie、用户文件、生产 `.data` 加入提交。

## Review Focus

1. hydration 前、初始关闭、动画中关闭：内容立刻落到正确终点，不出现透明拦截层（Task 1 / Task 5）。
2. ResizeObserver 重排期间快速反向筛选、滚出视口再返回：不闪回、不重播旧卡片，不产生持续重排（Task 2）。
3. 预览高清失败、滚动收起、组件被卸载：已显示的封面与访客遮盖不中断，旧异步结果不覆盖新预览（Task 3）。
4. 触屏或 zen 形态中目标队列入口隐藏、连续入队：视觉可降级，任务数量和 toast 仍然准确（Task 4）。
5. 灯箱带缩放时双指转单指、后台恢复、快速开关：手势直接跟手、旧退出不能关闭新灯箱、滚动锁正确释放（Task 5）。

以上五类必须各有行为测试或明确记录的真实浏览器验收，不能用 CSS 源码字符串快照代替。

## 文件与职责

| 文件 | 变化 |
| --- | --- |
| `src/lib/motion-runtime.ts`（新） | token 读取、策略桥、只属于 UI 的动画登记与清理 |
| `src/lib/motion.ts` | 保留 FLIP 数学，接入托管播放和中断协议 |
| `src/components/theme-provider.tsx` | hydration / 设置变化时同步动画策略 |
| `src/components/settings/appearance.tsx` | 已有主题揭示接入关停；不改变主题交互 |
| `src/lib/masonry-motion.ts`（新） | 可见卡片几何快照与重排 FLIP |
| `src/components/masonry-board.tsx`、`artwork-card.tsx`、`src/styles.css` | 几何落位、transform 所有权与关停样式 |
| `src/components/proxied-img.tsx`、`hover-preview.tsx` | 短揭示、缩略图衔接、预览中断和卸载 |
| `src/components/ui/sliding-pill.tsx`、`tabs.tsx`、`toggle-group.tsx`、`app-shell.tsx` | 选中背景独立变换、导航标记与开关覆盖 |
| `src/components/ui/dialog.tsx`、`dropdown-menu.tsx`、`popover.tsx`、`select.tsx`、`tooltip.tsx` | 校准已有进出类，保留无障碍行为 |
| `src/lib/paper-fly.ts` | 可见目标筛选、三张上限、取消清理 |
| `src/components/image-lightbox.tsx` | 开合与手势分层、退出生命周期与即时关停 |
| `e2e/fixtures/motion-study.ts`、`e2e/motion-polish.spec.ts`（新） | 无真实图站依赖的组合场景 |

## 执行与提交顺序

建议当前会话顺序实施，统一底层协议后再展开；并行修改 `motion.ts` / `styles.css` 容易让不同场景形成不同清理规则。5 个任务组成设计里的 4 批：Task 1 → Task 2 → Task 3 + Task 4 → Task 5。第三批可以保留两个小提交、合为同一个 PR；每个 PR 在自己通过验收后才能进入下一批。

### Task 1: 可关停的动效生命周期（第一批）

**Files:** Create `src/lib/motion-runtime.ts`、`src/lib/motion-runtime.test.ts`；Modify `src/lib/motion.ts`、`src/components/theme-provider.tsx`、`src/components/settings/appearance.tsx`、`src/styles.css`、`CHANGELOG.md`；保留 `src/lib/motion.test.ts` 数学回归。

**Interfaces:** 新模块不导入 store，不在模块加载时访问 document。导出以下接口，后续任务只依赖这一组：

```ts
export type MotionPreset = "micro" | "quick" | "layer" | "fast" | "slow";
export type MotionEnd = "finished" | "cancelled" | "disabled";
export type OwnedMotion = {
  finished: Promise<MotionEnd>;
  finish(): void;
  cancel(): void;
};
export function readMotionTiming(el: Element, preset: MotionPreset): { duration: number; easing: string };
export function canAnimateUi(): boolean;
export function setUiMotionEnabled(enabled: boolean): void;
export function playOwnedMotion(el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions, onFinish?: () => void): OwnedMotion;
export function commitOwnedMotion(el: HTMLElement): { transform: string; opacity: number };
export function cancelOwnedAnimations(el: HTMLElement): void;
```

`playOwnedMotion` 的调用者先使底层 DOM/CSS 表示最终状态，再用关键帧覆盖短暂过程。`finished` 总是 resolve；只有正常完成、主动 finish 和 disabled 执行 `onFinish`，并且只执行一次；cancel 用于改向/卸载，不触发旧的结束业务。disabled 的 `onFinish` 同步执行。`finish()` 终止无限漂浮时也要落回底层静态状态，不能盲调原生无限动画的 finish。

`commitOwnedMotion` 先读取当前视觉，再固化 transform / opacity，取消本模块登记的该元素动画；不取消别人的动画。后续播放结束需移除中断快照的临时行内样式，恢复最终态。`canAnimateUi` 在 hydration 策略尚未明确、SSR 或缺少 WAAPI 时返回 false。旧 `animateFlip` 返回 `OwnedMotion`；保持其 `finished` 调用形态并用 live/generation 闸识别旧结果。

- [x] **Step 1: 写关闭与取消行为测试。** 在新测试先引入 `../test/dom.ts`；关闭时把元素 animate 桩设为抛错，执行以下断言；再用局部 Animation double 覆盖播放中关闭、cancel 拒绝和无限播放，不把 double 加进生产代码。

```ts
setUiMotionEnabled(false);
let completed = 0;
const el = document.createElement("div");
el.animate = () => { throw new Error("disabled must not animate"); };
const handle = playOwnedMotion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 }, () => completed++);
assert.equal(completed, 1);
assert.equal(await handle.finished, "disabled");
handle.finish();
assert.equal(completed, 1);
```

另外锁定：取消当前 native finished 会拒绝时，外层 handle 仍 resolve cancelled；开关关闭完成全部已登记 handle，未登记的 Animation 不受影响；未知策略不播放；读取 `0.15s` 得到 150ms，读取 preset 返回既有曲线。

- [x] **Step 2: 跑测试确认覆盖新缺口。** `node --import tsx --test src/lib/motion-runtime.test.ts src/lib/motion.test.ts`；新增接口缺失或行为断言失败为预期红灯，不能把测试环境报错当红灯。
- [x] **Step 3: 实现 runtime 与旧 helper 接入。** ThemeProvider 在 persisted ready 和 motionEnabled 变化时先更新策略；补齐已有 `playEnter`、`animateFlip`、`animateDrift` 的注册、终态和 will-change 清理。hover 的反向退出回调只有相应那次动画完成才生效。
- [x] **Step 4: 接通 CSS / 主题关停。** 给新增过渡挂 `.kami-xfade`；补 `html[data-motion="off"]::view-transition-old(root)` / `new(root)`，不能用不存在的 class 代替伪元素。主题 ready 回调再次检查策略，托管其返回的 WAAPI 动画，并处理 ready / finished 的取消拒绝；不更改圆形主题揭示的产品行为。
- [x] **Step 5: 跑定向测试与类型检查。** 上述测试、`pnpm typecheck` 均通过；验证初始 off 和 hydration 前不会短暂起播，不改变 store schema。
- [x] **Step 6: 记录并提交第一批。** 更新 CHANGELOG 的 Unreleased；仅提交本任务文件，建议消息 `feat: 统一纸感动效生命周期与动画开关`。

### Task 2: 浏览网格的连续重排（第二批，依赖 Task 1）

**Files:** Create `src/lib/masonry-motion.ts`、`src/components/masonry-board.test.tsx`、`e2e/fixtures/motion-study.ts`、`e2e/motion-polish.spec.ts`；Modify `src/components/masonry-board.tsx`、`src/components/artwork-card.tsx`、`src/styles.css`、`CHANGELOG.md`；保留 `src/lib/masonry-flow.test.ts`。

**Interfaces:** 消费 Task 1 的 runtime 和 `MotionRect`。新模块导出 `snapshotMasonry(root: HTMLElement): Map<HTMLElement, MotionRect>`、`playMasonryReflow(root: HTMLElement, before: Map<HTMLElement, MotionRect>): void`、`clearMasonryMotion(root: HTMLElement): void`；只作用于 root 的直接子卡片。

fixture 导出 `seedMotionStudy(page: import("@playwright/test").Page): Promise<void>`，在既有隔离 e2e server 上预置 onboarded / 固定非敏感偏好，拦截 `/api/source` 和媒体请求，按现有 `FetchOk` / `WorkCard` 类型返回 200 张静态图卡、40 张后续页及详情所需响应；只复用隔离的测试认证机制，不访问真实图站/账号/.data，不新增正式演示路由。Task 3–5 逐步扩展同一个 spec。

- [x] **Step 1: 写行为测试。** 局部桩测量矩形与 ResizeObserver / IntersectionObserver，锁定 `same geometry after repack`、`append does not replay existing cards`、`rapid resize uses current visual rect`、`offscreen and motion off skip playback`、`unmount cancels pending frame and owned animations`。用可观察的几何变量、播放调用和节点身份断言，不断言私有函数调用次数以外的实现顺序细枝。

```ts
assert.equal(existingCard.isSameNode(cardAfterAppend), true);
assert.equal(existingCard.style.getPropertyValue("--masonry-x"), expectedX);
assert.equal(existingCard.style.getPropertyValue("--masonry-w"), expectedWidth);
assert.equal(replayedExistingCards.length, 0);
```

- [x] **Step 2: 跑红灯。** `node --import tsx --test src/components/masonry-board.test.tsx`；预期旧实现无法满足可中断 transform FLIP 与不重播的断言。
- [x] **Step 3: 在 packBoard 接入 First / Last。** 批量读旧视觉矩形 → 一次写最终几何 → 批量读新矩形 → 可见区域 ±120px 内存量卡片播放 250ms FLIP；复用既有合帧调度，不在逐卡写后立即读引发强制布局循环。无有效尺寸/离屏/新增卡片直接落位。
- [x] **Step 4: 分离冲突并删掉布局补间。** article 的位置 transform 只归 FLIP；`.kami-card-shell` 保留 hover、可一次性淡显；图片只做 opacity 揭示。删除 packed settled 的 left/top/width/height 过渡，容器高度一次更新。保留 article 的 ref、data-aspect、稳定 key、键盘焦点和事件接线；vault variant 不改算法。
- [x] **Step 5: 验证结果。** 建立上述 fixture 和首批重排/追加 E2E，跑新组件测试、`node --experimental-strip-types --test src/lib/masonry-flow.test.ts`、`pnpm typecheck`、`pnpm test:e2e e2e/motion-polish.spec.ts`；用同一 fixture 在真实浏览器录制 200 张卡片重排/追加/返回，核对几何、滚动锚点和动画稳定段没有本次代码造成的逐帧 Layout。
- [x] **Step 6: 记录并提交第二批。** CHANGELOG 写明重排与连续操作体验；建议消息 `perf: 浏览网格改用可中断的 FLIP 重排`。

### Task 3: 图片揭示与悬停预览（第三批上半，依赖 Task 1/2）

**Files:** Create `src/components/proxied-img.test.tsx`、`src/components/hover-preview.test.tsx`；Modify `src/components/proxied-img.tsx`、`src/components/hover-preview.tsx`、`src/styles.css`、`e2e/motion-polish.spec.ts`、`CHANGELOG.md`。仅在清理必须时改 `use-card-interactions.ts`，不改现有 520ms 预览触发阈值、160ms 预取阈值或预览滚轮语义。

**Interfaces:** ProxiedImg 的既有 props 保持兼容；新增可选 `fallbackSrc?: string` 用于高清未就绪时保持缩略图，默认为 undefined，不改其他调用者。HoverPreview 的外部 props 不变，使用 Task 1 的 `OwnedMotion` 和 `animateFlip`。

- [ ] **Step 1: 写有意义的回归。** 测试名锁定 `warm image is visible without replay`、`source changes before previous load completes`、`fallback remains visible when hd fails`、`veil also covers fallback`、`preview open-close-open ignores obsolete finish`、`scroll/unmount removes preview and owned playback`。不改共享 DOM 垫片；需要更真实 IO/WAAPI 的测试在本文件安装并恢复桩。

```ts
assert.equal(shownImage.getAttribute("src"), expectedCurrentSrc);
assert.equal(obsoleteCloseRemovedCurrentPreview, false);
assert.equal(remainingPreviewNodesAfterUnmount, 0);
```

- [ ] **Step 2: 跑红灯。** `node --import tsx --test src/components/proxied-img.test.tsx src/components/hover-preview.test.tsx`；高清失败衔接与新生命周期断言应暴露旧行为缺口。
- [ ] **Step 3: 实现短揭示和预览衔接。** 用 quick token 的 150ms opacity 揭示替换 500ms 缩放；缓存命中立即显示。预览先展示已加载封面，高清成功后短淡换；维持原图裁切、访客遮盖、车道和重试。新 fallback 不触发另一条绕过媒体车道的请求。
- [ ] **Step 4: 统一预览进退和清理。** 按 fast token 250ms 展开、quick 150ms 收回；中断取当前视觉，不跳回 from；修复浮层渐隐的硬编码与总开关登记，滚动/卸载解除残余动画。静态预览仍可在 off 时打开，关闭补间不等于禁止预览功能。
- [ ] **Step 5: 复验。** 新测试和 `pnpm typecheck` 通过；向已有动效 E2E 加入缓存命中、高清失败和滚动收起用例。浏览器快速掠过卡片、滚动收起、高清失败时没有空白放大框或未遮盖 fallback。
- [ ] **Step 6: 提交。** 建议消息 `feat: 图片揭示与悬停预览统一纸感节奏`。

### Task 4: 控件反馈与飞纸入队（第三批下半，依赖 Task 1/3）

**Files:** Create `src/components/ui/sliding-pill.test.tsx`、`src/lib/paper-fly.test.ts`；Modify `src/components/ui/sliding-pill.tsx`、`tabs.tsx`、`toggle-group.tsx`、`src/components/app-shell.tsx`、`src/lib/paper-fly.ts`、`src/styles.css`、`e2e/motion-polish.spec.ts`、`CHANGELOG.md`；按实际样式使用调整表中五种浮层组件。

**Interfaces:** `useSlidingPill` / `PillBox` 外部用途保持；在同一文件新增 `SlidingPill({ box, className }: { box: PillBox; className?: string }): React.ReactNode` 作为纯背景，不包裹文字。`flyPaperToQueue(from?: DOMRect | null): void` 和 `rectFromEvent` 不变；新增 `visibleQueueTarget(root: ParentNode = document): HTMLElement | null`，只从现有 `[data-queue-nav]` 入口选择尺寸有效、未隐藏且在视口内的目标。

- [ ] **Step 1: 写控件与队列测试。** 覆盖不同宽度/换行项选中、首挂载不入场、连续 A→B→A、隐藏桌面导航与可见移动导航共存、完全没有目标、20 次连续入队后最多三张在途纸片、关停和卸载后的节点释放。

```ts
assert.equal(visibleQueueTarget(), mobileQueueLink);
assert.ok(document.querySelectorAll(".kami-fly-sheet").length <= 3);
setUiMotionEnabled(false);
assert.equal(document.querySelectorAll(".kami-fly-sheet").length, 0);
```

滑块测试断言文字容器不带缩放，最终背景矩形对应选中项；位移/缩放播放交给真浏览器看。业务 enqueue 调用与 toast 文案在集成用例断言，不能仅用飞纸数量证明入队成功。

- [ ] **Step 2: 跑红灯。** `node --import tsx --test src/components/ui/sliding-pill.test.tsx src/lib/paper-fly.test.ts`，旧的隐藏目标选择和无上限临时纸片应失败。
- [ ] **Step 3: 实现背景层和纸感反馈。** 滑块的目标宽高一次落位，transform 在独立背景层补间，不拉伸 label；导航只调整现有选中标记的节奏与关停。卡片 clean hover 降至 2–3px；hand 维持微歪；按钮适合处按 80/150ms 做 0.97 按压，输入与拖柄保持稳定。
- [ ] **Step 4: 实现可见目标、合并视觉与浮层节奏。** 飞纸 fast/slow 取 slow 400ms；三张上限之后跳过额外纸片，业务队列/计数/toast 照常。无目标或无 WAAPI 直接结束视觉函数；finish/cancel/off 都移除临时节点并处理 finished 拒绝。已有浮层展开 layer 220ms、收起 quick 150ms，保留 Radix 焦点与 Escape 行为。
- [ ] **Step 5: 验证。** 定向测试和 `pnpm typecheck` 通过；向已有动效 E2E 加入选中条、可见队列目标和真实业务入队次数断言。触屏无 hover 仍可操作；四类目标形态下飞纸不会飞向隐藏的零尺寸节点。未完成任务不出现收入完成折角。
- [ ] **Step 6: 提交第三批。** 建议消息 `feat: 统一控件动效与可见队列入队反馈`；与 Task 3 合为第三批 PR。

### Task 5: 灯箱手势与整体验收（第四批，依赖 Task 1–4）

**Files:** Modify `src/components/image-lightbox.tsx`、`src/components/image-lightbox.test.tsx`、`src/styles.css`、`CHANGELOG.md`、`e2e/fixtures/motion-study.ts`、`e2e/motion-polish.spec.ts`。

**Interfaces:** ImageLightbox 的 `items/index/open/onClose/onIndex/originUrl/footer` 接口不变；消费 Task 2 的 `seedMotionStudy`，补齐多 P 图像/错误响应，保持相同的无真实网络夹具。

- [ ] **Step 1: 扩展灯箱行为测试。** 保留旧的换页旧图立刻消失/加载失败测试。新增 `open=false closes synchronously while motion is off`、`disable during enter keeps open=true visible`、`close-open ignores old exit`、`disable during close removes interception layer`、`pinch and drag have no interpolation`、`single pointer continues after pinch`、`strip scroll is instant when disabled`、`unmount restores body overflow`。

```ts
assert.equal(document.querySelector('[aria-label="大图预览"]'), null);
assert.equal(document.body.style.overflow, overflowBeforeOpen);
assert.equal(lastStripScrollOptions.behavior, "instant");
```

手势断言模拟 pointerId 与坐标，验证位图变换即时到达位置；光标/双指锚点缩放语义沿用现有逻辑，不新增滑动换页功能。

- [ ] **Step 2: 跑红灯。** `node --import tsx --test src/components/image-lightbox.test.tsx`；新增 off 同步退出和旧退出竞态用例应失败，旧加载行为仍通过。
- [ ] **Step 3: 拆开外层进退和内层手势。** 展开 fast 250ms、收起 quick 150ms；pointer 手势期间 transform 无 transition，离散缩放可短过渡。退出依赖托管结束与 generation 闸，不用固定 300ms 作为卸载权威；动效关闭时同步落到当前 open 的目标态（true 保持可见，false 才卸载），重新打开不能被旧回调关闭。没有 rAF 驱动的透明可见性死锁。
- [ ] **Step 4: 接通焦点、滚动与缩略条。** 关闭和卸载清理 pointer/pinch、退出回调和滚动锁；返回打开前焦点（可用且仍挂载时）。关动效时缩略条即时定位；保留既有键盘、预热、切页加载与错误文案。
- [ ] **Step 5: 写组合 E2E。** 使用 fixture 断言 200 张卡片可见、追加 40 张后前部节点不重播；浏览→详情→返回位置误差不超过 2px；连续预览开关与灯箱开关各 30 次没有残余 UI 临时节点；入队反馈次数与业务 enqueue 数对应；on/off/off→on 覆盖 CSS 与 JS。对真实上游关键路径回归单独运行并单独报告环境失败，不把它当动效证据。
- [ ] **Step 6: 执行全局验收。** `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e e2e/motion-polish.spec.ts`、`pnpm test:e2e e2e/critical-path.spec.ts e2e/browse-cache.spec.ts`。构建可能执行既有迁移，使用隔离 KAMI_ROOT，准备 migrations 后按现有 e2e-server 合同验证，不对真实数据目录执行测试迁移。
- [ ] **Step 7: 检查真实渲染与性能。** 1280px / 390px、浅深主题、clean/hand、desk/rail/zen 抽样；Chrome、Firefox、可获得的 Safari/iOS Safari，WebKit 模拟结果注明。用相同设备/数据/操作录制基线与修改版，确认重排动画稳定段没有自定义代码逐帧 Layout、没有新增 >50ms 长任务；60Hz 接近 60fps 是目标，不做未经录制的保证。截图不能证明动态连续性。
- [ ] **Step 8: 完成第四批和全分支复核。** 更新 CHANGELOG，建议消息 `feat: 灯箱开合与缩放拖拽分层`；请求一次独立整体复核，再按仓库要求发 PR。出现回归先停用应用动效，按第四批→第三批→第二批→第一批逆序撤回，不改存储版本与业务数据。

## 当前交付状态与实施入口

- 动效方向已由用户确认，独立设计审阅没有重要遗留问题；正式实现待后续明确进入实施。
- 实施时先建立适合的隔离工作区，再从 Task 1 执行；本轮未创建新工作区、安装依赖或运行产品构建/测试。
- 当前 shell 未发现全局 pnpm。执行前解析项目已有包管理入口，优先与 packageManager 指定版本一致；需要安装时遵循当次环境权限，不把工具缺失当测试通过。
- 独立示意页只用于判断节奏，不能复用为正式代码或性能证据；其浏览器点击验收仍待可用工具恢复。本计划的正式验收必须在真实组件完成后重做。
