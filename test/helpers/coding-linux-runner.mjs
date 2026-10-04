// Disposable pinned-image qualification helper, not a production launcher.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, realpath} from "node:fs/promises";
import {execFileSync, spawn} from "node:child_process";
assert.equal(process.platform, "linux"); assert.equal(process.arch, "arm64");
assert.equal(process.version, "v22.23.1");
assert.match(execFileSync("/usr/bin/bwrap", ["--version"], {encoding: "utf8"}), /bubblewrap 0\.8\.0/);
const aliases = ["/lib/aarch64-linux-gnu/libdl.so.2", "/lib/aarch64-linux-gnu/libstdc++.so.6", "/lib/aarch64-linux-gnu/libm.so.6", "/lib/aarch64-linux-gnu/libgcc_s.so.1", "/lib/aarch64-linux-gnu/libpthread.so.0", "/lib/aarch64-linux-gnu/libc.so.6", "/lib/ld-linux-aarch64.so.1"];
const runtimeFiles = await Promise.all(aliases.map(async mountPath => {const path = await realpath(mountPath); return {path, mountPath, sha256: createHash("sha256").update(await readFile(path)).digest("hex")};}));
const child = spawn(process.execPath, ["--test", "test/coding-resource.test.mjs", "test/coding-confinement.test.mjs"], {stdio: "inherit", env: {PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C", CHIO_CODING_LINUX_PROBE: "1", CHIO_CODING_LINUX_RUNTIME_JSON: JSON.stringify(runtimeFiles)}});
child.once("error", error => {throw error;}); child.once("close", code => process.exitCode = code ?? 1);
