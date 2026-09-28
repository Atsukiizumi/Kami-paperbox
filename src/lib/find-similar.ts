/**
 * 「找相似的」收纳链（M2-3：浏览卡/纸匣卡右键 → 搜图页自动开搜）。
 *
 * 作用：把一张图经 mediaUrl 抓下来塞进搜图暂存（stashReverseImage），随后由
 *      调用方跳 /search——页面 boot 的 takeReverseImage 通道零改动承接。
 * 用法：stashImageForSearch(work.thumb, `${work.id}.jpg`) 成功后再 navigate。
 * 为什么经 mediaUrl：它对 /api/、blob:、data: 直通、外站 URL 走代理——浏览
 *      缩略图与纸匣封面一条链通吃（照作品页 searchFromWork 先例）。
 */
import { stashReverseImage } from "@/lib/reverse-search";
import { mediaUrl } from "@/lib/utils";
import { toast } from "sonner";

export async function stashImageForSearch(url: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(mediaUrl(url));
    if (!res.ok) throw new Error("读不到预览图");
    const blob = await res.blob();
    const bytes = await blob.arrayBuffer();
    stashReverseImage({ name, type: blob.type || "image/jpeg", bytes });
    return true;
  } catch {
    // 抓不到图就不跳转：跳过去也只是空搜图页，固定话术安静失败即可
    toast.error("无法用来搜图");
    return false;
  }
}
