import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ascii2dBovwUrl, parseAscii2dHtml, parseIqdbHtml, parseSauceNaoHtml, parseSauceNaoJson, parseTinEyeJson, workFromUrl } from "./reverse-search.ts";

const SAUCE = `
<div class="result"><table class="resulttable"><tr><td class="resulttableimage"><div class="resultimage" ><a href="https://saucenao.com/search.php?db=999"><img src="https://img1.saucenao.com/res/pixiv/6825/68259314_p0_master1200.jpg" /></a></div></td><td class="resulttablecontent"><div class="resultmatchinfo"><div class="resultsimilarityinfo">95.34%</div></div><div class="resultcontent"><div class="resulttitle"><strong>白丝袜</strong><br /></div><div class="resultcontentcolumn"><strong>pixiv ID: </strong><a href="https://www.pixiv.net/member_illust.php?mode=medium&illust_id=68259314" class="linkify">68259314</a><br /><strong>Member: </strong><a href="https://www.pixiv.net/member.php?id=26690900" class="linkify">璽子</a></div></div></td></tr></table></div>
<div class="result hidden"><table class="resulttable"><tr><td class="resulttableimage"><div class="resultimage"><img src="https://img1.saucenao.com/x.jpg" /></div></td><td><div class="resultsimilarityinfo">94.46%</div><div class="resultcontentcolumn"><strong>Creator: </strong>unamaso<br /><strong>Source: </strong><a href="https://www.pixiv.net/artworks/146142253">pixiv #146142253</a></div></td></tr></table></div>
<div class="result hidden"><table class="resulttable"><tr><td><div class="resultsimilarityinfo">12%</div><a href="https://example.com/x">x</a></td></tr></table></div>
`;

const IQDB = `
<div id='pages' class='pages'><div><table><tr><th>Your image</th></tr><tr><td class='image'><img src='/thu/thu_x.jpg'></td></tr></table></div>
<div><table><tr><th>Best match</th></tr><tr><td class='image'><a href="https://yande.re/post/show/447155"><img src='/moe.imouto/2/5/5/2555.jpg' alt="Rating: s Score: 1035 Tags: landscape sky" title="Rating: s Score: 1035 Tags: landscape sky"></a></td></tr><tr><td><img alt="icon" src="/icon/yandere.ico" class="service-icon">yande.re</td></tr><tr><td>94% similarity</td></tr></table></div>
<div><table><tr><th>Additional match</th></tr><tr><td class='image'><a href="//danbooru.donmai.us/posts/3091441"><img src='/danbooru/f/a/e/fae.jpg' alt="Rating: e Tags: loli"></a></td></tr><tr><td>80% similarity</td></tr></table></div>
</div>
`;

describe("reverse search parsers", () => {
  it("maps pixiv and booru URLs to in-app works", () => {
    assert.deepEqual(workFromUrl("https://www.pixiv.net/artworks/68259314"), {
      site: "pixiv",
      id: "68259314",
    });
    assert.deepEqual(workFromUrl("https://yande.re/post/show/447155"), {
      site: "yande",
      id: "447155",
    });
    assert.equal(workFromUrl("https://example.com/foo"), null);
  });

  it("parses SauceNAO HTML, keeps high-similarity hidden rows, skips low ones", () => {
    const hits = parseSauceNaoHtml(SAUCE, true);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.similarity, 95.34);
    assert.equal(hits[0]?.site, "pixiv");
    assert.equal(hits[0]?.workId, "68259314");
    assert.equal(hits[0]?.author, "璽子");
    assert.equal(hits[1]?.similarity, 94.46);
    assert.equal(hits[1]?.workId, "146142253");
    assert.equal(hits[1]?.author, "unamaso");
  });

  it("decodes SauceNAO titles that use HTML entities", () => {
    const html = `<div class="result"><table class="resulttable"><tr><td><div class="resultsimilarityinfo">88%</div><div class="resulttitle"><strong>A \u0026amp; B</strong></div><a href="https://www.pixiv.net/artworks/1">1</a></td></tr></table></div>`;
    const hits = parseSauceNaoHtml(html, false);
    assert.equal(hits[0]?.title, "A & B");
  });

  it("parses SauceNAO JSON results the same way as the website", () => {
    const hits = parseSauceNaoJson({
      results: [
        {
          header: { similarity: "94.46", thumbnail: "https://img1.saucenao.com/a.jpg", index_name: "Index #5: Pixiv" },
          data: {
            pixiv_id: 146142253,
            member_name: "unamaso",
            title: "niko",
            ext_urls: ["https://www.pixiv.net/artworks/146142253"],
          },
        },
      ],
    }, true);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.similarity, 94.46);
    assert.equal(hits[0]?.workId, "146142253");
    assert.equal(hits[0]?.author, "unamaso");
  });

  it("parses IQDB HTML, keeps safe hits, drops loli even if listed", () => {
    const hits = parseIqdbHtml(IQDB, true);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.site, "yande");
    assert.equal(hits[0]?.workId, "447155");
    assert.equal(hits[0]?.similarity, 94);
    assert.match(hits[0]?.thumb ?? "", /iqdb\.org/);
  });

  it("parses TinEye JSON matches", () => {
    const hits = parseTinEyeJson({
      matches: [
        {
          score: 95.4,
          domain: "safebooru.org",
          image_url: "https://img.tineye.com/result/abc",
          backlinks: [
            {
              backlink: "https://safebooru.org/index.php?id=1&page=post&s=view",
              image_name: "cat.jpg",
            },
          ],
        },
      ],
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.similarity, 95.4);
    assert.equal(hits[0]?.author, "safebooru.org");
    assert.match(hits[0]?.sourceUrl ?? "", /safebooru/);
  });

  it("parses ascii2d item-box rows and bovw hash links", () => {
    const html = `
<div class="row item-box">
  <div class="image-box"><img src="/thumbnail/query.jpg" /></div>
  <div class="info-box"><div class="hash">abc</div><small>800x600</small></div>
</div>
<div class="row item-box">
  <div class="image-box"><img src="/thumbnail/146142253.jpg" /></div>
  <div class="info-box">
    <div class="detail-box gray-link">
      <h6>
        <a href="https://www.pixiv.net/artworks/146142253">メイド</a>
        <a href="https://www.pixiv.net/users/123">unamaso</a>
      </h6>
    </div>
  </div>
</div>
<a href="/search/bovw/deadbeefcafebabe">特徴検索</a>
`;
    const hits = parseAscii2dHtml(html, "特征");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.engine, "ascii2d");
    assert.equal(hits[0]?.workId, "146142253");
    assert.equal(hits[0]?.site, "pixiv");
    assert.equal(hits[0]?.author, "unamaso");
    assert.equal(hits[0]?.extra, "特征");
    assert.equal(ascii2dBovwUrl(html, "https://ascii2d.net/search/color/111"), "https://ascii2d.net/search/bovw/deadbeefcafebabe");
  });
});
