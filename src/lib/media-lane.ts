/**
 * 浏览器侧图片加载车道（全局并发闸）。
 *
 * 作用：把同时进行的 /api/media 图片加载压到 MAX_ACTIVE 条以内，给导航、
 *       详情数据这些小而快的请求留出同源连接（HTTP/1.1 每源默认 6 条）。
 * 用法：acquireMediaLane(priority) 拿到 release()；<img> load / error / 卸载时调用。
 *       priority 的加载（详情页首图）排队时插队。
 * 为什么：浏览页一屏 20-30 张卡片全落在 ±800px 预热带里会同时发图，代理图又慢
 *        （上游几百 ms 到几秒）；6 条连接全被占住时，点卡片的路由数据请求排在
 *        图片后面——实测点击到跳转能卡近 10 秒，主线程全程空闲，纯排队。
 */

const MAX_ACTIVE = 4;

type Entry = { priority: boolean; granted: boolean };

let active = 0;
const queue: Entry[] = [];

function pump() {
  while (active < MAX_ACTIVE && queue.length > 0) {
    let i = queue.findIndex((e) => e.priority);
    if (i < 0) i = 0;
    const e = queue.splice(i, 1)[0]!;
    active += 1;
    e.granted = true;
  }
}

/** 占一条车道；返回 release，重复调用安全。排队中取消（卸载）直接出队。 */
export function acquireMediaLane(priority = false): () => void {
  const e: Entry = { priority, granted: false };
  if (active < MAX_ACTIVE) {
    active += 1;
    e.granted = true;
  } else {
    queue.push(e);
  }
  return () => {
    if (e.granted) {
      e.granted = false;
      active -= 1;
      pump();
    } else {
      const i = queue.indexOf(e);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}
