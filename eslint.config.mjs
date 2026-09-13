import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for Kami 纸匣 (Next.js App Router). */
export default tseslint.config(
  {
    ignores: [
      "next-env.d.ts",
      "dist/**",
      ".output/**",
      ".next/**",
      ".vercel/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      // M9（TD-23 教训成规）：queryClient 写/读方法的 queryKey 必须先提取为
      // 变量再传入——内联数组字面量极易与 useQuery 处的 key 漂移（TD-23：
      // credentialTag 指纹 vs cookie 原文）。useQuery 的 queryKey 不受此限。
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(setQueryData|getQueryData|ensureQueryData|fetchQuery)$/u] > ArrayExpression:first-child",
          message:
            "queryKey 必须提取为共享常量/变量后再传给 queryClient 方法（防与 useQuery 的 key 不一致，TD-23）",
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
