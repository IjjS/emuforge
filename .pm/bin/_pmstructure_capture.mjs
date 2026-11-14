// The browser part of pm-structure (design 2.3). Not run by hand: _pmbrowse.capture copies this file under
// <worktree>/studio/output/ (so node resolves @playwright/test from studio/node_modules) and runs
//
//   node .structure-capture-<pid>.mjs <job.json>
//
// job: {url, out, storageState?, viewport, settleMs, settleMax, navTimeout, refuse}. Opens `url` in headless Chromium,
// aborts every request whose host is not a loopback IP address and lists it, waits until two accessibility trees
// taken `settleMs` apart are equal, and writes the snapshot (design 2.2) to `out`.
// Exit 0 written; 10 the browser did not start; 11 the page could not be opened (error or status >= 400);
// 12 the page did not settle within `settleMax`; 13 anything else. The message of 10, 11 and 13 is one stderr line
// starting with "pm-structure-capture: ". Nothing is downloaded or installed, TLS errors are never ignored.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const PREFIX = "pm-structure-capture: ";
const FORMAT = "pm-structure-snapshot/1";
const LAUNCH = 10, OPEN = 11, SETTLE = 12, OTHER = 13;

let browser = null;

async function fail(code, error) {
  const text = String((error && error.message) || error || "no message");
  const line = text.split("\n").map((s) => s.trim()).find((s) => s) || "no message";
  process.stderr.write(PREFIX + line + "\n");
  if (browser) await browser.close().catch(() => {});
  process.exit(code);
}

// a loopback IP literal: 127.0.0.0/8 or [::1]; the URL parser has already normalized the host
function loopback(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return false;
  if (u.hostname === "[::1]") return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(u.hostname);
  return !!m && m.slice(1).every((x) => Number(x) <= 255);
}

// Chromium's full accessibility tree as a pre-order list of the nodes that are not ignored and not InlineTextBox;
// the walk goes through ignored nodes to their children and `parent` is the nearest kept ancestor
function flatten(axNodes) {
  const byId = new Map(axNodes.map((n) => [n.nodeId, n]));
  const roots = axNodes.filter((n) => !n.parentId || !byId.has(n.parentId));
  const out = [];
  const seen = new Set();
  const stack = roots.reverse().map((n) => [n, null]);
  while (stack.length) {
    const [n, parent] = stack.pop();
    if (seen.has(n.nodeId)) continue;
    seen.add(n.nodeId);
    const role = n.role && n.role.value != null ? String(n.role.value) : "";
    let here = parent;
    if (!n.ignored && role !== "InlineTextBox") {
      out.push({ role, name: n.name && n.name.value != null ? String(n.name.value) : "", parent });
      here = out.length - 1;
    }
    const kids = (n.childIds || []).map((id) => byId.get(id)).filter(Boolean);
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], here]);
  }
  return out;
}

async function main() {
  const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  try {
    // Requests reached through an HTTP redirect are not seen by context.route, so the browser also goes through a
    // proxy at job.refuse, a loopback port that refuses every connection, bypassed only for loopback addresses:
    // a request to any other host fails on this machine and nothing leaves it (design 6, N3 and T1)
    browser = await chromium.launch({
      headless: true, timeout: 30000,
      proxy: { server: `http://127.0.0.1:${job.refuse}`, bypass: "127.0.0.0/8,[::1]" },
    });
  } catch (e) {
    return fail(LAUNCH, e);
  }
  const context = await browser.newContext({
    viewport: job.viewport, colorScheme: "light", deviceScaleFactor: 1, serviceWorkers: "block",
    storageState: job.storageState || undefined,
  });
  const blocked = new Set();
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (loopback(url)) return route.continue();
    blocked.add(url);
    return route.abort("aborted"); // ERR_ABORTED: a blocked navigation leaves the page on its document
  });
  context.on("request", (request) => { // redirect hops, which the route above never sees
    if (!loopback(request.url())) blocked.add(request.url());
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (loopback(ws.url())) return ws.connectToServer();
    blocked.add(ws.url());
    return ws.close();
  });
  const page = await context.newPage();
  let response;
  try {
    response = await page.goto(job.url, { waitUntil: "networkidle", timeout: job.navTimeout });
  } catch (e) {
    return fail(OPEN, e);
  }
  if (response && response.status() >= 400) return fail(OPEN, String(response.status()));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const start = Date.now();
  let previous = null;
  let nodes;
  for (;;) {
    nodes = flatten((await cdp.send("Accessibility.getFullAXTree")).nodes);
    const text = JSON.stringify(nodes);
    if (text === previous) break;
    previous = text;
    if (Date.now() - start >= job.settleMax) return fail(SETTLE, "did not settle");
    await new Promise((resolve) => setTimeout(resolve, job.settleMs));
  }
  const snapshot = {
    format: FORMAT, url: page.url(), viewport: job.viewport, browser: `chromium ${browser.version()}`,
    blocked: [...blocked].sort(), nodes,
  };
  const tmp = `${job.out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 1) + "\n");
  fs.renameSync(tmp, job.out);
  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => fail(OTHER, e));
