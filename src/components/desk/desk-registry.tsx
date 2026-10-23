"use client";

/**
 * 案头模块注册表（布局引擎 P1）。
 *
 * 作用：槽模型五件套 id → 组件的映射，附渲染上下文（纸叠要未读数据）。
 * 用法：desk.tsx / desk-edit.tsx 按 DeskLayout.items 取节点渲染：
 *       DESK_MODULE_NODES[id]({ unread, unreadCount })。
 * 为什么：布局引擎只认 id 不 import 具体组件——模块增减只改这张表，
 *        编辑器与渲染共用一处事实。
 */
import type { ReactNode } from "react";
import { DeskArtistWall } from "./artist-wall";
import { DeskBrowseSheet } from "./browse-sheet";
import { DeskLetters } from "./letters";
import { DeskNewspaper } from "./newspaper";
import { DeskStack } from "./stack";
import type { DeskModuleId } from "@/lib/desk-layout";
import type { VaultMeta } from "@/lib/types";

export type DeskModuleCtx = { unread: VaultMeta[]; unreadCount: number };

export const DESK_MODULE_NODES: Record<DeskModuleId, (ctx: DeskModuleCtx) => ReactNode> = {
  "browse-sheet": () => <DeskBrowseSheet />,
  newspaper: () => <DeskNewspaper />,
  letters: () => <DeskLetters />,
  stack: (ctx) => <DeskStack count={ctx.unreadCount} items={ctx.unread} />,
  "artist-wall": () => <DeskArtistWall />,
};
