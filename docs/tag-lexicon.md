# 图站标签译文

Yande / Konachan / Danbooru 界面显示中文，搜索请求仍用英文 tag。

文件格式 JSON：

```json
{
  "format": "kami-tag-lexicon-v1",
  "tags": [
    { "en": "hatsune_miku", "zh": "初音未来" },
    { "en": "landscape", "zh": "风景" }
  ]
}
```

字段：

- `en`：英文 tag，下划线写法，和源站一致
- `zh`：中文显示。留空表示还没译

设置里「导出标签清单」会带上当前收集到的全部 tag。自己填 `zh`，再「导入译文」。用户译文覆盖内置词表。
