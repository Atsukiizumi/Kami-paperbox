# -*- coding: utf-8 -*-
"""patch-shell-bindery.py — 批二：纸格第五内置主题 + 外壳细线 chrome + 演示间入口"""
import io

def patch(path, pairs):
    s = io.open(path, encoding="utf-8").read()
    for old, new in pairs:
        assert old in s, f"{path}: NOT FOUND {old[:60]!r}"
        s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8", newline="").write(s)
    print(f"patched {path} ({len(pairs)})")

# ---------- 1. theme.ts：注册 bindery ----------
patch("src/lib/theme.ts", [
    (
        'export const THEME_IDS = ["washi", "aosumi", "shusha", "songyan", "koke"] as const;',
        'export const THEME_IDS = ["washi", "aosumi", "shusha", "songyan", "koke", "bindery"] as const;',
    ),
    (
        "\n\nexport const THEME_LIST: ThemeDefinition[] = THEME_IDS.map((id) => THEMES[id]);",
        """
  bindery: {
    id: "bindery",
    name: "纸格",
    description: "装帧工房 · 纸面与印红",
    // Grok 会话 01a1742d 定稿「纸格」双态色板：亮=三层纸色（纸/纸背/paper-2）+印泥红，
    // 暗=夜案（墨黑书案家族）。朱红语义沿用 danger（日期章/未读/印章）。
    dark: {
      bg: "#0e0d0c",
      surface: "#1b1916",
      elevated: "#26231f",
      fg: "#f3efe8",
      muted: "#a39c93",
      subtle: "#6f6a64",
      accent: "#e8dfd2",
      accentFg: "#1a1714",
      danger: "#e8a09a",
      ok: "#9cba9a",
    },
    light: {
      bg: "#f3efe8",
      surface: "#e7dfd2",
      elevated: "#f7f3ec",
      fg: "#141210",
      muted: "#5e5954",
      subtle: "#8a8378",
      accent: "#141210",
      accentFg: "#f7f3ec",
      danger: "#8f3d32",
      ok: "#3d6b42",
    },
  },
};

export const THEME_LIST: ThemeDefinition[] = THEME_IDS.map((id) => THEMES[id]);""".replace(
            "\n};\n\nexport const THEME_LIST", ""
        ).replace(
            "  },\n};\n\nexport", "\n\nexport"
        ),
    ),
])

# 上面 replace 链只为吞掉原对象闭合 —— 直接校验结果
s = io.open("src/lib/theme.ts", encoding="utf-8").read()
assert '"bindery"' in s and s.count("export const THEME_LIST") == 1

# ---------- 2. styles.css：bindery 变量块（插在 koke light 块之后） ----------
css_anchor = """html[data-theme="koke"][data-appearance="light"] {
  --color-bg: #f0f2e8;
  --color-surface: #e4e7d8;
  --color-elevated: #f7f8f0;
  --color-fg: #181c14;
  --color-muted: #5c6354;
  --color-subtle: #8a9080;
  --color-accent: #4a5836;
  --color-accent-fg: #f0f2e8;
  --color-danger: #b4544a;
  --color-ok: #3d6b42;
}"""
bindery_css = css_anchor + """

/* 纸格（BINDERY，批二）：亮=三层纸色 + 印泥红；暗=夜案墨黑家族 */
html[data-theme="bindery"][data-appearance="dark"] {
  --color-bg: #0e0d0c;
  --color-surface: #1b1916;
  --color-elevated: #26231f;
  --color-fg: #f3efe8;
  --color-muted: #a39c93;
  --color-subtle: #6f6a64;
  --color-accent: #e8dfd2;
  --color-accent-fg: #1a1714;
  --color-danger: #e8a09a;
  --color-ok: #9cba9a;
}

html[data-theme="bindery"][data-appearance="light"] {
  --color-bg: #f3efe8;
  --color-surface: #e7dfd2;
  --color-elevated: #f7f3ec;
  --color-fg: #141210;
  --color-muted: #5e5954;
  --color-subtle: #8a8378;
  --color-accent: #141210;
  --color-accent-fg: #f7f3ec;
  --color-danger: #8f3d32;
  --color-ok: #3d6b42;
}"""
c = "src/styles.css"
css = io.open(c, encoding="utf-8").read()
assert css_anchor in css
css = css.replace(css_anchor, bindery_css, 1)

# ---------- 3. 外壳细线 chrome（追加到文件末尾） ----------
css = css.rstrip() + """

/* ── 纸格主题外壳 chrome（批二）：细线 + 直角，仅 data-theme="bindery" 作用域 ──
   顶栏/侧栏/浮胶囊/移动底栏圆角归零、边界换发丝线；按钮同步直角。 */
html[data-theme="bindery"] .kami-topbar {
  border-radius: 0;
  border-bottom: 1px solid color-mix(in oklab, var(--color-fg) 14%, transparent);
}
html[data-theme="bindery"] .kami-aside {
  border-radius: 0;
  border-right: 1px solid color-mix(in oklab, var(--color-fg) 14%, transparent);
}
html[data-theme="bindery"] .kami-float-controls {
  border-radius: 0;
  border: 1px solid color-mix(in oklab, var(--color-fg) 14%, transparent);
}
html[data-theme="bindery"] .kami-chrome-up {
  border-radius: 0;
}
html[data-theme="bindery"] .kami-topbar button,
html[data-theme="bindery"] .kami-aside button,
html[data-theme="bindery"] .kami-float-controls button {
  border-radius: 0;
}
"""
io.open(c, "w", encoding="utf-8", newline="").write(css)
print("styles.css: bindery vars + chrome hairlines")

# ---------- 4. appearance.tsx：主题卡下加演示间入口 ----------
patch("src/components/settings/appearance.tsx", [
    (
        "import { useSettings } from \"@/lib/store\";",
        "import { useSettings } from \"@/lib/store\";\nimport { Link } from \"@/lib/kami-link\";",
    ),
    (
        "      />\n    </>\n  );\n}\n\n/** 主题包管理（P2）",
        """      />
      {/* BINDERY 演示间入口（批二）：风格基准页，设置里可达 */}
      <Link
        to="/bindery"
        className="mt-2 inline-flex items-baseline gap-2 self-start border-b border-dashed border-border/70 pb-0.5 text-xs text-muted transition-colors hover:text-fg"
      >
        BINDERY 装帧演示间
        <span className="font-mono text-[10px] tracking-[0.2em]">/BINDERY</span>
      </Link>
    </>
  );
}

/** 主题包管理（P2）""",
    ),
])

# ---------- 5. theme.test.ts：数量 5→6 ----------
patch("src/lib/theme.test.ts", [
    ("assert.equal(THEME_IDS.length, 5);", "assert.equal(THEME_IDS.length, 6);"),
])

# ---------- 6. CHANGELOG ----------
cl = io.open("CHANGELOG.md", encoding="utf-8").read()
anchor = "## [Unreleased]\n\n### 新增\n\n"
assert anchor in cl
entry = "- **第六套内置主题「纸格」（BINDERY 批二）**：设置→外观新增「纸格 · 装帧工房 · 纸面与印红」——亮色为 Grok 定稿的三层纸色（纸/纸背/paper-2）配印泥红 `#8F3D32`，暗色为夜案墨黑家族；选择后外壳 chrome 同步换装（顶栏/侧栏/浮胶囊/移动底栏圆角归零、边界换发丝线）；主题卡下方新增「BINDERY 装帧演示间」入口直达 `/bindery`。既有五主题与主题包体系零改动。\n"
io.open("CHANGELOG.md", "w", encoding="utf-8", newline="").write(cl.replace(anchor, anchor + entry, 1))
print("CHANGELOG updated")
