# 图站标签数据库

对应 EhTagTranslation/Database，但词表是 Yande.re / Konachan / Danbooru 这一系，不是 E 站命名空间。

## 格式

`tags.json` / 应用内 `src/data/booru-database.json`：

```json
{
  "format": "kami-booru-database-v1",
  "sites": ["yande", "konachan", "danbooru"],
  "namespaces": ["general", "copyright", "character", "artist", "circle", "meta"],
  "tags": [{ "en": "hatsune_miku", "zh": "初音未来", "ns": "character", "count": 123 }]
}
```

- `en`：图站检索用的英文 tag（下划线）。
- `zh`：界面显示。空字符串表示还没收录译文。
- `ns`：general / copyright / character / artist / circle / meta。
- `count`：Yande.re 近期按使用量抽样时的次数，只作排序，不是全站精确值。

## 覆盖关系

1. 本数据库（打包进应用）
2. 浏览时收到的词（本机仓库 `kami-tag-catalog`）
3. 用户在设置里写的 zh（`kami-tag-lexicon`，覆盖前两层）

搜索请求始终发 `en`。

## 更新

从 Yande.re `tag.json?order=count` 拉高频词，再把已有译文合进去。用户导出的 `{ tags: [{ en, zh }] }` 可以并回本文件。

## 鸣谢

- [zhzwz/yande-re-chinese-patch](https://github.com/zhzwz/yande-re-chinese-patch)：Yande / Konachan 中文标签词表
- [Yande.re](https://yande.re/)：公开 tag 接口（`/tag.json`）
- [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)：命名空间分层的做法。本库不收录、不转发 E 站译文

