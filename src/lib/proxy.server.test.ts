import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { clearSavedProxy, readProxyState, resolveKamiRoot, saveProxyUrl } from "./proxy.server.ts";

function withDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "kami-proxy-"));
  const prev = process.env.KAMI_PROXY;
  delete process.env.KAMI_PROXY;
  try {
    writeFileSync(
      join(dir, "kami.config.json"),
      `${JSON.stringify({ host: "0.0.0.0", port: 8080, proxy: "" }, null, 2)}\n`,
    );
    writeFileSync(join(dir, "kami.config.example.json"), "{}\n");
    run(dir);
  } finally {
    if (prev === undefined) delete process.env.KAMI_PROXY;
    else process.env.KAMI_PROXY = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("save writes kami.config.json and runtime file", () => {
  withDir((dir) => {
    const state = saveProxyUrl("127.0.0.1:7890", dir);
    assert.equal(state.url, "http://127.0.0.1:7890");
    assert.equal(state.source, "saved");
    const cfg = JSON.parse(readFileSync(join(dir, "kami.config.json"), "utf8")) as {
      proxy?: string;
      port?: number;
    };
    assert.equal(cfg.proxy, "http://127.0.0.1:7890");
    assert.equal(cfg.port, 8080);
    const runtime = JSON.parse(readFileSync(join(dir, ".data", "proxy.json"), "utf8")) as {
      set?: boolean;
      url?: string;
    };
    assert.equal(runtime.set, true);
    assert.equal(runtime.url, "http://127.0.0.1:7890");
    assert.equal(readProxyState(dir).url, "http://127.0.0.1:7890");
    assert.equal(process.env.KAMI_PROXY, "http://127.0.0.1:7890");
  });
});

test("clear removes runtime override and empties config proxy", () => {
  withDir((dir) => {
    saveProxyUrl("socks5://127.0.0.1:1080", dir);
    const cleared = clearSavedProxy(dir);
    assert.equal(cleared.url, "");
    const cfg = JSON.parse(readFileSync(join(dir, "kami.config.json"), "utf8")) as { proxy?: string };
    assert.equal(cfg.proxy, "");
    assert.equal(readProxyState(dir).source, "none");
  });
});

test("resolveKamiRoot walks up to the marker file", () => {
  withDir((dir) => {
    const nested = join(dir, "src", "lib");
    mkdirSync(nested, { recursive: true });
    assert.equal(resolveKamiRoot(nested), dir);
  });
});
