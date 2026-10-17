/**
 * XAccountCard（X 设置卡）RTL：Cookie 框输入/清空 round-trip、缺字段提示、
 * queryId 覆盖写表，以及占位符默认值与 upstream X_QUERY_IDS 的交叉断言。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { XAccountCard } from "./x-account.tsx";
import { X_DEFAULT_QUERY_IDS } from "@/lib/x-settings";
import { useSettings } from "@/lib/store";
import { X_QUERY_IDS } from "@/lib/upstream/x.ts";

const X_TOKEN = "a".repeat(40);
const X_CT0 = "b".repeat(40);
const X_OK = `auth_token=${X_TOKEN}; ct0=${X_CT0}`;

describe("XAccountCard（X 设置卡）", () => {
  // setXCookie 会触发 syncSessions → POST /api/sessions；不垫 fetch 会冒未处理拒绝
  let fetchOriginal: typeof fetch;
  before(() => {
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = fetchOriginal;
  });

  beforeEach(() => {
    cleanup();
    useSettings.setState({ xCookie: "", xGraphQLQueryIds: {}, accounts: [], activeAccountId: null });
  });

  it("queryId 占位符默认值与 upstream X_QUERY_IDS 一致（客户端镜像防漂）", () => {
    // x-account 不能 import 服务端 x.ts（node 依赖），默认表手抄在这里——
    // X 发版换默认值时两处必须一起改，此断言就是那个提醒
    assert.deepEqual({ ...X_DEFAULT_QUERY_IDS }, { ...X_QUERY_IDS });
  });

  it("Cookie 输入 round-trip：输入落 store、清空回空", () => {
    render(<XAccountCard />);
    const input = screen.getByLabelText("X Cookie") as HTMLInputElement;
    fireEvent.change(input, { target: { value: X_OK } });
    assert.equal(useSettings.getState().xCookie, X_OK);
    fireEvent.change(input, { target: { value: "" } });
    assert.equal(useSettings.getState().xCookie, "");
  });

  it("半截 Cookie（缺 ct0）显示补全提示，完整的不提示", () => {
    render(<XAccountCard />);
    fireEvent.change(screen.getByLabelText("X Cookie"), { target: { value: `auth_token=${X_TOKEN}` } });
    assert.ok(screen.getByText(/需要同时带 auth_token 与 ct0/));
    fireEvent.change(screen.getByLabelText("X Cookie"), { target: { value: X_OK } });
    assert.equal(screen.queryByText(/需要同时带 auth_token 与 ct0/), null, "完整 Cookie 不提示");
  });

  it("queryId 覆盖输入写表、清空撤覆盖；脏字符被清洗挡回", () => {
    render(<XAccountCard />);
    fireEvent.change(screen.getByLabelText("UserByScreenName"), { target: { value: "NewId_1" } });
    assert.deepEqual(useSettings.getState().xGraphQLQueryIds, { userByScreenName: "NewId_1" });
    // 清空 = 未覆盖：键从表里消失
    fireEvent.change(screen.getByLabelText("UserByScreenName"), { target: { value: "" } });
    assert.deepEqual(useSettings.getState().xGraphQLQueryIds, {});
  });
});
