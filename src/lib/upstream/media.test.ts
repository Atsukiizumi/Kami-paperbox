/**
 * SEC-08 行为保持矩阵（parseAllowedMediaUrl）。
 *
 * 作用：白名单从「后缀匹配」换成「精确子域集」后，仓库取证到的全部真实
 *       媒体域照旧放行，私网 / 整数写法 / 伪装域照旧拦截。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAllowedMediaUrl } from "./media.ts";

test("真实在用媒体域全部放行（mapping 固定样本 + fixture + 运行时常量）", () => {
  const allowed = [
    // pixiv（mapping.test.ts 样本 i.pximg.net；s / pixiv 为运行时常量）
    "https://i.pximg.net/img-master/img/2026/01/01/00/00/00/123456789_p0_master1200.jpg",
    "https://s.pximg.net/common/images/emoji/101.png",
    "https://pixiv.pximg.net/c/1200x1200/novel-cover/123.jpg",
    // FANBOX（mapping.test.ts 样本 downloads.fanbox.cc）
    "https://downloads.fanbox.cc/images/post/20260101/c/1200x630/aB3cD4.jpeg",
    // yande.re（thumb-url.test.ts files、page-thumbs.test.ts 主域预览、assets 为常量）
    "https://files.yande.re/image/aB3cD4eF5g.jpg",
    "https://assets.yande.re/data/previews/001/123/456/preview.jpg",
    "https://yande.re/data/preview/ab/cd/abc123.jpg",
    // konachan 主站与镜像（booru-sites.ts KONACHAN_ORIGIN / KONACHAN_MIRROR）
    "https://konachan.com/sample/aB3cD4.jpg",
    "https://konachan.net/sample/aB3cD4.jpg",
    // Danbooru（danbooru-channel.test.ts cdn）
    "https://cdn.donmai.us/full/aB3cD4.jpg",
    "https://danbooru.donmai.us/data/sample/aB3cD4.jpg",
    // 搜图引擎（reverse-search.test.ts 样本 img1.saucenao.com / 主域锚点）
    "https://saucenao.com/displayimage.php?mode=sample&di=aB3c",
    "https://img1.saucenao.com/res/pixiv/6825/68259314_p0_master1200.jpg",
    "https://img2.saucenao.com/res/pixiv/6825/68259314_p0_master1200.jpg",
    "https://img3.saucenao.com/res/pixiv/6825/68259314_p0_master1200.jpg",
    "https://iqdb.org/thm/aB3cD4.jpg",
    "https://ascii2d.net/thumbnail/aB3cD4.jpg",
  ];
  for (const raw of allowed) {
    const url = parseAllowedMediaUrl(raw);
    assert.equal(url.protocol, "https:", raw);
  }
});

test("私网与伪装地址拦截结论与改前一致", () => {
  const illegal = [
    // 明文私网 / 回环 / metadata
    "https://127.0.0.1/img.jpg",
    "https://10.1.2.3/img.jpg",
    "https://192.168.1.1/img.jpg",
    "https://169.254.169.254/latest/meta-data/",
    "https://172.16.0.9/img.jpg",
    "https://172.31.255.9/img.jpg",
    "https://[::1]/img.jpg",
    "https://[::ffff:127.0.0.1]/img.jpg",
    "https://[fd12::1]/img.jpg",
    // 整数写法（new URL 已折叠成点分私网，归一化兜底再拦一次）
    "https://2130706433/img.jpg",
    "https://0x7f000001/img.jpg",
    "https://0177.0.0.1/img.jpg",
    // 域名形态
    "https://localhost/img.jpg",
    "https://sub.localhost/img.jpg",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://foo.internal/img.jpg",
    "https://bar.local/img.jpg",
  ];
  for (const raw of illegal) {
    assert.throws(() => parseAllowedMediaUrl(raw), /非法地址/, raw);
  }
});

test("白名单外 / 伪装成白名单的域拦截（精确集收紧面）", () => {
  const rejected = [
    "https://evil.example.com/img.jpg",
    "https://notpximg.net/img.jpg",
    "https://i.pximg.net.evil.com/img.jpg",
    "https://pximg.net.evil.com/img.jpg",
    // 旧后缀规则会放行的任意子域——精确集有意收紧（改前=放行，改后=拦截）
    "https://i2.pximg.net/img.jpg",
    "https://evil.fanbox.cc/img.jpg",
    "https://www.fanbox.cc/img.jpg",
    "https://img4.saucenao.com/img.jpg",
    "https://files.konachan.com/img.jpg",
    // http / userinfo
    "http://i.pximg.net/img.jpg",
    "https://u:p@i.pximg.net/img.jpg",
  ];
  for (const raw of rejected) {
    assert.throws(() => parseAllowedMediaUrl(raw), /不支持的图片来源|非法地址|只允许 https/, raw);
  }
});
