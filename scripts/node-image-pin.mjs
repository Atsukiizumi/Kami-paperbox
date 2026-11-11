/**
 * Node 基础镜像钉扎。
 *
 * Dockerfile 的两段 FROM 与 CI 的 node-version 必须是同一版 Node 24，
 * 并且等于 nodejs.org 上 24 线的最新稳定版。浮动 tag（node:24）不会在
 * 发版时自动换掉已发布的镜像层，所以这里只接受完整的 x.y.z。
 */

export const NODE_IMAGE_VARIANT = "bookworm-slim";

const FROM_RE = /^FROM\s+node:(\S+)\s+AS\s+\S+/gm;
const NODE_VERSION_RE = /^[\t ]*node-version:\s*["']?([^\s"'#]+)/gm;
const STABLE_24 = /^v24\.(\d+)\.(\d+)$/;

/** @param {string} text */
export function dockerNodeRefs(text) {
  return [...text.matchAll(FROM_RE)].map((match) => match[1]);
}

/** @param {string} text */
export function ciNodeVersions(text) {
  return [...text.matchAll(NODE_VERSION_RE)].map((match) => match[1]);
}

/**
 * @param {Array<{ version?: string }>} index
 * @returns {string | null} `24.x.y`，没有稳定版时是 null
 */
export function latestNode24(index) {
  let best = null;
  for (const row of index) {
    const version = typeof row?.version === "string" ? row.version : "";
    const match = STABLE_24.exec(version);
    if (!match) continue;
    const next = [Number(match[1]), Number(match[2])];
    if (!best || next[0] > best.parts[0] || (next[0] === best.parts[0] && next[1] > best.parts[1])) {
      best = { parts: next, version: version.slice(1) };
    }
  }
  return best ? best.version : null;
}

/**
 * @param {{ dockerfile: string, workflows: string[], latest: string }} input
 * @returns {{ ok: true, version: string } | { ok: false, errors: string[] }}
 */
export function checkNodePin(input) {
  const errors = [];
  const refs = dockerNodeRefs(input.dockerfile);
  const expectedRef = `${input.latest}-${NODE_IMAGE_VARIANT}`;
  if (refs.length === 0) errors.push("Dockerfile 里没有 FROM node:…");
  for (const ref of refs) {
    if (ref !== expectedRef) errors.push(`Dockerfile 钉的是 node:${ref}，Node 24 线最新稳定版是 ${expectedRef}`);
  }
  const versions = input.workflows.flatMap((text) => ciNodeVersions(text));
  if (versions.length === 0) errors.push("CI workflow 里没有 node-version");
  for (const version of versions) {
    if (version !== input.latest) errors.push(`CI node-version 是 ${version}，应与镜像一致为 ${input.latest}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, version: input.latest };
}
