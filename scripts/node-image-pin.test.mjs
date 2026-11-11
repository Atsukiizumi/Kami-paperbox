import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNodePin, ciNodeVersions, dockerNodeRefs, latestNode24 } from "./node-image-pin.mjs";

const DOCKERFILE = `FROM node:24.22.2-bookworm-slim AS build
FROM node:24.22.2-bookworm-slim AS runner
`;

test("dockerNodeRefs 只取 node 基础镜像", () => {
  assert.deepEqual(dockerNodeRefs(DOCKERFILE), ["24.22.2-bookworm-slim", "24.22.2-bookworm-slim"]);
  assert.deepEqual(dockerNodeRefs("FROM debian:bookworm\n"), []);
});

test("latestNode24 忽略其它主版本和预发布", () => {
  assert.equal(
    latestNode24([
      { version: "v27.0.0-alpha.0.0.0" },
      { version: "v26.13.0" },
      { version: "v24.22.2" },
      { version: "v24.22.1" },
      { version: "v24.23.0-rc.0" },
    ]),
    "24.22.2",
  );
  assert.equal(latestNode24([{ version: "v22.23.4" }]), null);
});

test("两段镜像和 CI 都钉在最新 24 才通过", () => {
  const ok = checkNodePin({
    dockerfile: DOCKERFILE,
    workflows: ["node-version: 24.22.2\nnode-version: 24.22.2\n"],
    latest: "24.22.2",
  });
  assert.equal(ok.ok, true);

  const behind = checkNodePin({
    dockerfile: "FROM node:24.22.1-bookworm-slim AS build\nFROM node:24-bookworm-slim AS runner\n",
    workflows: ["node-version: 24\n"],
    latest: "24.22.2",
  });
  assert.equal(behind.ok, false);
  if (!behind.ok) assert.equal(behind.errors.length, 3);
});

test("ciNodeVersions 不把注释里的版本当成钉扎", () => {
  assert.deepEqual(ciNodeVersions("# node-version: 24\n  node-version: 24.22.2\n"), ["24.22.2"]);
});
