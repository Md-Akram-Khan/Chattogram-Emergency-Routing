const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

function findBrowser() {
  return CANDIDATES.find(p => fs.existsSync(p)) || null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ width = 1600, height = 1000 } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error("No Chromium-based browser found (set CHROME_PATH)");
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ctg-e2e-"));
  const proc = spawn(exe, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "about:blank"
  ], { stdio: "ignore" });

  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
  }
  if (!targets) { proc.kill(); throw new Error("browser did not start"); }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push(msg.params.args.map(a => a.value || a.description).join(" "));
    }
  });
  const send = (method, params = {}) => new Promise(resolve => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  const browser = {
    errors,
    send,
    async goto(url, readyExpr = "true", timeoutMs = 20000) {
      await send("Page.navigate", { url });
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        await sleep(150);
        try { if (await browser.evaluate(readyExpr)) return Date.now() - t0; } catch { }
      }
      throw new Error(`page not ready: ${readyExpr}`);
    },
    async evaluate(expr) {
      const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "evaluate failed");
      return res.result.result.value;
    },
    async type(text) {
      await send("Input.insertText", { text });
    },
    async key(k) {
      const codes = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 };
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: codes[k] });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: codes[k] });
    },
    async resize(w, h) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    },
    async screenshot(file) {
      const res = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(res.result.data, "base64"));
    },
    async close() {
      try { ws.close(); } catch { }
      proc.kill();
      await sleep(300);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
    }
  };
  return browser;
}

module.exports = { launch, findBrowser, sleep };
