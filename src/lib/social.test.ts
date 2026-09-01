import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookmarkTagsOf, extractPixivCsrfToken, isAlreadySocialError, pixivHtmlLooksLoggedOut, socialFromPixivIllust } from "./social.ts";

describe("pixiv social", () => {
  it("reads bookmark and like flags from illust ajax", () => {
    const off = socialFromPixivIllust({ likeData: false, bookmarkData: null });
    assert.equal(off.liked, false);
    assert.equal(off.bookmarked, false);
    const on = socialFromPixivIllust({
      likeData: true,
      bookmarkData: { id: "99", private: false },
      isFollowed: true,
    });
    assert.equal(on.liked, true);
    assert.equal(on.bookmarked, true);
    assert.equal(on.bookmarkId, "99");
    assert.equal(on.followed, true);
  });

  it("treats already-bookmarked as a no-op", () => {
    assert.equal(isAlreadySocialError("You've already bookmarked this illust"), true);
    assert.equal(isAlreadySocialError("既にブックマーク済みです"), true);
    assert.equal(isAlreadySocialError("无法解析 Pixiv CSRF"), false);
  });

  it("keeps a short tag list for quick bookmark", () => {
    assert.deepEqual(bookmarkTagsOf([" 猫 ", "R-18", "风景"]), ["猫", "风景"]);
  });

  it("reads csrf from meta-global-data even when it is not hex", () => {
    const html = `<meta id="meta-global-data" content='{"token":"AbCdEfGhIjKlMnOpQr123456","userData":{"id":"1"}}'>`;
    assert.equal(extractPixivCsrfToken(html), "AbCdEfGhIjKlMnOpQr123456");
  });

  it("reads csrf from html-entity encoded meta", () => {
    const html =
      "<meta id=\"meta-global-data\" content=\"{\u0026quot;token\u0026quot;:\u0026quot;zz11yy22xx33ww44vv55uu66\u0026quot;}\">";
    assert.equal(extractPixivCsrfToken(html), "zz11yy22xx33ww44vv55uu66");
  });

  it("reads csrf from single-quoted meta-global-data JSON", () => {
    const html = `<meta name="global-data" id="meta-global-data" content='{"token":"5faddbf5966ad6879fb5f6d2f848f5f5","userData":{"id":"1"}}'>`;
    assert.equal(extractPixivCsrfToken(html), "5faddbf5966ad6879fb5f6d2f848f5f5");
  });

  it("reads csrf from Next.js __NEXT_DATA__ preloaded api.token", () => {
    const state = JSON.stringify({ api: { token: "0d09e0bbcd4ae59750b15bbaa96d0d7c" } });
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { serverSerializedPreloadedState: state } },
    })}</script>`;
    assert.equal(extractPixivCsrfToken(html), "0d09e0bbcd4ae59750b15bbaa96d0d7c");
  });

  it("reads csrf-token meta regardless of attribute order", () => {
    const html = `<meta content="tt-token-value-12345" name="csrf-token">`;
    assert.equal(extractPixivCsrfToken(html), "tt-token-value-12345");
  });

  it("does not treat a login page as a token source", () => {
    const html = `<form action="https://accounts.pixiv.net/login"><input name="password"></form>`;
    assert.equal(extractPixivCsrfToken(html), undefined);
    assert.equal(pixivHtmlLooksLoggedOut(html), true);
  });
});

