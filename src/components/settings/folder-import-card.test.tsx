/**
 * FolderImportCard（从文件夹导入卡）RTL：未授权禁用、预览三数、批级站点选择器
 * 出现条件、导入执行按已在匣跳过。
 * 环境垫片：../../test/dom.ts 必须最先引入；scan/loadKeys/runImport 走组件注入
 * （照 TagTidyCard items 先例），不碰真实 IDB / fetch。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FolderImportCard } from "./folder-import-card.tsx";
import { useSettings } from "@/lib/store";
import type { ImportPlan, ImportScanResult } from "@/lib/storage/folder-import";

function file(path: string, size = 100, lastModified = 1000): ImportScanResult {
  return { path, size, lastModified };
}

const SITE_AUTHOR_TEMPLATE = "{source}/{author}/{id}_p{page}_{title}.{ext}";

describe("FolderImportCard（从文件夹导入）", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ pathTemplate: SITE_AUTHOR_TEMPLATE, folderLabel: "下载" });
  });

  it("未授权：入口禁用并提示先授权，不渲染预览", () => {
    render(<FolderImportCard granted={false} />);
    const button = screen.getByRole("button", { name: "扫描文件夹" });
    assert.equal((button as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByText(/需要先在上方选择并授权下载文件夹/));
    assert.equal(screen.queryByText("导入预览"), null);
  });

  it("扫描后预览三数；模板含 {source} 时批级站点选择器不出现", async () => {
    const scan = async () => [
      file("pixiv/こいし/1000_p0_无题.jpg"),
      file("pixiv/こいし/1000_p1_无题.jpg", 200, 2000),
    ];
    render(<FolderImportCard granted scan={scan} />);
    fireEvent.click(screen.getByRole("button", { name: "扫描文件夹" }));
    // 两页合成一条：新导入 1、跳过 0、无法识别 0
    await screen.findByText(/新导入 1 条 · 跳过已在匣 0 条 · 无法识别 0 个/);
    assert.equal(screen.queryByRole("combobox"), null);
  });

  it("模板无 {source}：批级站点选择器出现，未选站前导入禁用", async () => {
    useSettings.setState({ pathTemplate: "{author}/{id}_p{page}_{title}.{ext}" });
    render(<FolderImportCard granted scan={async () => [file("こいし/12345_p0_无题.jpg")]} />);
    fireEvent.click(screen.getByRole("button", { name: "扫描文件夹" }));
    await screen.findByText("导入预览");
    // 未选站：匹配文件停在无法识别侧，选择器在位且导入不可点
    assert.ok(screen.getByRole("combobox", { name: "批级站点" }));
    assert.ok(screen.getByText(/新导入 0 条 · 跳过已在匣 0 条 · 无法识别 1 个/));
    const start = screen.getByRole("button", { name: /开始导入/ });
    assert.equal((start as HTMLButtonElement).disabled, true);
  });

  it("导入执行：已在匣 key 整组跳过，只写入新 key，完成汇报三数", async () => {
    // 闭包里赋值的裸变量会被 TS 控制流收窄成 never，用持有对象装
    const captured: { plan: ImportPlan | null } = { plan: null };
    const scan = async () => [
      file("pixiv/こいし/1000_p0_无题.jpg"),
      file("pixiv/こいし/1001_p0_无题.jpg", 300, 3000),
    ];
    const loadKeys = async () => new Set(["pixiv:1000"]);
    const runImport = async (plan: ImportPlan) => {
      captured.plan = plan;
      return { imported: plan.records.length, serverFailed: 0, failed: 0 };
    };
    render(<FolderImportCard granted scan={scan} loadKeys={loadKeys} runImport={runImport} />);
    fireEvent.click(screen.getByRole("button", { name: "扫描文件夹" }));
    await screen.findByText(/新导入 1 条 · 跳过已在匣 1 条 · 无法识别 0 个/);
    fireEvent.click(screen.getByRole("button", { name: /开始导入/ }));
    await screen.findByText(/导入完成/);
    assert.ok(screen.getByText(/新导入 1 条 · 跳过已在匣 1 条 · 无法识别 0 个/));
    const plan = captured.plan;
    assert.ok(plan);
    assert.equal(plan.records.length, 1);
    // 已在匣的 pixiv:1000 不进执行计划（幂等重跑的安全边际）
    assert.equal(plan.records[0].meta.key, "pixiv:1001");
    assert.equal(plan.records[0].meta.savedAt, 3000);
  });
});
