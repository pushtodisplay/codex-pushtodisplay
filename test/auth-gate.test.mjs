// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
  adoptGlobalAuth,
  authCachePath,
  ensureAuth,
  loadGlobalAuth,
  saveGlobalAuth,
} from "../lib/auth-gate.mjs";

/** @returns {{ env: NodeJS.ProcessEnv, cleanup: () => void }} */
function cache() {
  const dir = mkdtempSync(path.join(tmpdir(), "ptd-auth-"));
  return {
    env: { PUSHTODISPLAY_CACHE_DIR: dir },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("unknown auth waits for the probe instead of dropping the message", async () => {
  const { env, cleanup } = cache();
  try {
    /** @type {(value: boolean) => void} */
    let resolve = () => {};
    let started = 0;
    const probe = () => {
      started += 1;
      return new Promise((done) => {
        resolve = done;
      });
    };
    const state = { auth: null };
    const pending = ensureAuth(state, { probe, env });
    let decided = false;
    void pending.then(() => {
      decided = true;
    });
    await Promise.resolve();
    assert.equal(decided, false);
    assert.equal(started, 1);
    resolve(true);
    await assert.doesNotReject(pending);
    assert.equal(await pending, true);
    assert.equal(state.auth?.ok, true);
  } finally {
    cleanup();
  }
});

test("a good answer sends without probing again", async () => {
  const { env, cleanup } = cache();
  try {
    let probes = 0;
    const state = { auth: { ok: true, at: 1000 } };
    const ok = await ensureAuth(state, {
      probe: async () => {
        probes += 1;
        return false;
      },
      now: () => 2000,
      env,
    });
    assert.equal(ok, true);
    assert.equal(probes, 0);
  } finally {
    cleanup();
  }
});

test("a recent bad answer is not re-probed", async () => {
  const { env, cleanup } = cache();
  try {
    let probes = 0;
    const state = { auth: { ok: false, at: 1000 } };
    const ok = await ensureAuth(state, {
      probe: async () => {
        probes += 1;
        return true;
      },
      now: () => 5000,
      intervalMs: 20_000,
      env,
    });
    assert.equal(ok, false);
    assert.equal(probes, 0);
  } finally {
    cleanup();
  }
});

test("a stale bad answer is re-probed and recovers", async () => {
  const { env, cleanup } = cache();
  try {
    let probes = 0;
    const state = { auth: { ok: false, at: 1000 } };
    const ok = await ensureAuth(state, {
      probe: async () => {
        probes += 1;
        return true;
      },
      now: () => 25_000,
      intervalMs: 20_000,
      env,
    });
    assert.equal(ok, true);
    assert.equal(probes, 1);
    assert.equal(state.auth?.ok, true);
  } finally {
    cleanup();
  }
});

test("force probes even after a good answer (session start)", async () => {
  const { env, cleanup } = cache();
  try {
    let probes = 0;
    const state = { auth: { ok: true, at: 1000 } };
    const ok = await ensureAuth(state, {
      probe: async () => {
        probes += 1;
        return true;
      },
      now: () => 2000,
      force: true,
      env,
    });
    assert.equal(ok, true);
    assert.equal(probes, 1);
  } finally {
    cleanup();
  }
});

test("a successful login hint re-enables a known-bad session immediately", async () => {
  const { env, cleanup } = cache();
  try {
    mkdirSync(String(env.PUSHTODISPLAY_CACHE_DIR), { recursive: true });
    writeFileSync(authCachePath(env), JSON.stringify({ ok: true, at: 5000 }));
    const state = { auth: { ok: false, at: 1000 } };
    const ok = await ensureAuth(state, {
      probe: async () => {
        throw new Error("should adopt the hint instead of probing");
      },
      now: () => 6000,
      env,
    });
    assert.equal(ok, true);
    assert.equal(state.auth?.ok, true);
    assert.equal(state.auth?.at, 5000);
  } finally {
    cleanup();
  }
});

test("global auth hints are readable and only adopted when newer", () => {
  const { env, cleanup } = cache();
  try {
    mkdirSync(String(env.PUSHTODISPLAY_CACHE_DIR), { recursive: true });
    writeFileSync(authCachePath(env), JSON.stringify({ ok: true, at: 5000 }));
    assert.deepEqual(loadGlobalAuth(env), { ok: true, at: 5000 });
    const state = { auth: { ok: false, at: 6000 } };
    adoptGlobalAuth(state, env);
    assert.equal(state.auth.at, 6000);
    saveGlobalAuth(true, env);
    const global = loadGlobalAuth(env);
    assert.equal(global?.ok, true);
    assert.ok((global?.at ?? 0) > 5000);
  } finally {
    cleanup();
  }
});
