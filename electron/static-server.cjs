"use strict";

/**
 * Minimal read-only static file server for the packaged renderer.
 *
 * Electron needs a secure origin for getUserMedia (camera access). Serving the
 * built `dist/` directory from 127.0.0.1 gives the renderer a local HTTP origin
 * that Chromium treats as trustworthy, without requiring an internet
 * connection or a background service.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".task", "application/octet-stream"],
  [".data", "application/octet-stream"],
  [".bin", "application/octet-stream"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

function contentType(filePath) {
  return (
    MIME_TYPES.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream"
  );
}

function sendText(response, status, message, extraHeaders = {}) {
  const body = Buffer.from(message, "utf8");
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.byteLength,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

/**
 * @param {string} rootDir Directory to expose. It is resolved once, at startup.
 * @param {{host?: string, port?: number}} [options]
 * @returns {Promise<{url: string, origin: string, port: number, close: () => Promise<void>}>}
 */
async function startStaticServer(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const stat = await fsp.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Static root does not exist or is not a directory: ${root}`);
  }

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method not allowed", { Allow: "GET, HEAD" });
        return;
      }

      let pathname;
      try {
        pathname = decodeURIComponent(
          new URL(request.url ?? "/", "http://127.0.0.1").pathname,
        );
      } catch {
        sendText(response, 400, "Malformed path");
        return;
      }

      if (pathname.endsWith("/")) {
        pathname += "index.html";
      }

      const filePath = path.resolve(root, `.${pathname}`);
      const relative = path.relative(root, filePath);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        sendText(response, 403, "Forbidden");
        return;
      }

      const fileStat = await fsp.stat(filePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        sendText(response, 404, "Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Length": fileStat.size,
        // The app is used offline and updated as a whole. Revalidating avoids
        // stale MediaPipe WASM/model files after an upgrade.
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!response.headersSent) {
          sendText(response, 500, "Could not read file");
        } else {
          response.destroy();
        }
      });
      stream.pipe(response);
    } catch {
      if (!response.headersSent) {
        sendText(response, 500, "Internal server error");
      } else {
        response.destroy();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const origin = `http://${host}:${actualPort}`;

  return {
    url: `${origin}/`,
    origin,
    port: actualPort,
    close: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

module.exports = { startStaticServer };
