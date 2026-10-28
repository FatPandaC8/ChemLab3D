import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { startStaticServer } = require("../electron/static-server.cjs") as {
  startStaticServer: (
    root: string,
    options?: { host?: string; port?: number },
  ) => Promise<{
    url: string;
    origin: string;
    port: number;
    close: () => Promise<void>;
  }>;
};

const indexHtml = "<!doctype html><title>ChemLab test</title><h1>lab</h1>";
const appJs = "console.log('offline');\n";
const runtimeWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const modelTask = Buffer.from("task-model-bytes");

async function statusForRawPath(port: number, rawPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: rawPath, method: "GET" },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function checkStaticServer(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "chemlab-static-"));
  const secret = `${root}-secret.txt`;
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), indexHtml);
  await writeFile(path.join(root, "assets", "app.js"), appJs);
  await writeFile(path.join(root, "assets", "runtime.wasm"), runtimeWasm);
  await writeFile(path.join(root, "assets", "hand.task"), modelTask);
  await writeFile(secret, "this file is outside the served root");

  const server = await startStaticServer(root);
  try {
    const index = await fetch(server.url);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await index.text(), indexHtml);

    const script = await fetch(`${server.url}assets/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /javascript/);
    assert.equal(await script.text(), appJs);

    const wasm = await fetch(`${server.url}assets/runtime.wasm`);
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get("content-type"), "application/wasm");
    assert.deepEqual(Buffer.from(await wasm.arrayBuffer()), runtimeWasm);

    const model = await fetch(`${server.url}assets/hand.task`);
    assert.equal(model.status, 200);
    assert.equal(
      model.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.deepEqual(Buffer.from(await model.arrayBuffer()), modelTask);

    const head = await fetch(`${server.url}assets/app.js`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(
      head.headers.get("content-length"),
      String(Buffer.byteLength(appJs)),
    );
    assert.equal(await head.text(), "");

    const missing = await fetch(`${server.url}assets/missing.js`);
    assert.equal(missing.status, 404);

    const post = await fetch(server.url, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");

    // A raw, percent-encoded parent segment must never escape the root. URL
    // normalisation may collapse it to a root-relative 404; either way the
    // secret file must not be served.
    const traversal = await statusForRawPath(
      server.port,
      `/%2e%2e%2f${encodeURIComponent(path.basename(secret))}`,
    );
    assert.ok(
      traversal === 403 || traversal === 404,
      `expected 403/404 for traversal, received ${traversal}`,
    );

    const originCheck = new URL(server.url).origin;
    assert.equal(server.origin, originCheck);
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    await rm(secret, { force: true });
  }
}

await checkStaticServer();
console.log("electron: loopback static server, MIME types, traversal guard OK");
