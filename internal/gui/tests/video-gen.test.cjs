// Run with Node's test runner and Playwright on the module path; see README.md.
// Settings › Images has a Video generation row below Image generation
// (#2896): the model a /v1/videos request that names none is made with. It
// shows magpie's pick while none is named, offers Automatic, Off and every
// model that makes videos, and saves the pick; another setting saved keeps
// it. Left automatic it follows Image generation's Off, and says so; a
// model picked there makes videos with Image generation off, and Image
// generation's row then speaks of images only. A pick magpie can't find any
// more is said under the row. Every language; wide and at a phone's width,
// nothing running off to the side and no click scrolling; no backend, the
// API is faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");

const assets = path.resolve(__dirname, "../assets");

const videoModels = [
  { id: "grok/grok-imagine-video", name: "Grok Imagine Video", provider: "grok", providerName: "Grok", icon: "grok" },
  { id: "grok/grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", provider: "grok", providerName: "Grok", icon: "grok" },
];

function settingsPayload(lang, st) {
  return {
    theme: "light", lang, tray: "panel", quotaLeft: false, currency: "usd", textSize: 100,
    dock: false, dockWindow: false, proxy: "", redact: false, redactPersonal: false, redactWords: [],
    codexWarmup: "", claudeWarmup: "", codexWarmAt: "", claudeWarmAt: "", workbuddyCheckin: false, noStats: false,
    trayUsage: "", trayUsageEvery: 3, vision: "", imageGen: st.imageGen || "", videoGen: st.videoGen || "",
    version: "0.1.400", dir: "~/.config/magpie", gateway: "http://127.0.0.1:3425",
    proxyNow: "none", proxySource: "none", login: false,
    visionModels: [], imageGenModels: [], imageGenAuto: "",
    videoGenModels: videoModels, videoGenAuto: "grok/grok-imagine-video", videoGenMissing: st.missing || "",
    workbuddyCheckins: [], lanURLs: [],
    fx: { rate: 7.2, at: new Date().toISOString(), stale: false },
  };
}

function server(lang, posted, st) {
  return async (route) => {
    const req = route.request(), url = new URL(req.url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:true,textSize:100};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: { lang, theme: "light", textSize: 100 } });
    if (url.pathname === "/api/settings") {
      if (req.method() === "POST") {
        const b = JSON.parse(req.postData());
        posted.push(b);
        st.imageGen = b.imageGen || "";
        st.videoGen = b.videoGen || "";
      }
      return json(settingsPayload(lang, st));
    }
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/usage/quotas") return json([]);
    if (url.pathname === "/api/groups") return json({ groups: [], models: [] });
    if (url.pathname === "/api/window/fit") return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    const body = await fs.readFile(file).catch(() => null);
    await (body ? route.fulfill({ body, contentType }) : route.fulfill({ status: 404, body: "" }));
  };
}

const words = {
  en: { name: "Video generation", auto: "Automatic", off: "Off", follows: /^Automatic follows Image generation, which is off/,
    imagesOff: "Agents given Magpie Image can't generate images: the tool says it is off",
    bothOff: "Agents given Magpie Image can't generate images or videos: the tool says it is off",
    missing: /gone\/clip-9, picked here, isn't set up any more.+Grok Imagine Video · Grok, the automatic choice, makes videos in its place/ },
  zh: { name: "生视频模型", auto: "自动", off: "关闭", follows: /^「自动」跟随生图模型设置，而生图模型已关闭/,
    imagesOff: "已装 Magpie Image 的 Agent 无法生成图片，工具会提示已关闭",
    bothOff: "已装 Magpie Image 的 Agent 无法生成图片或视频，工具会提示已关闭",
    missing: /这里选的 gone\/clip-9 已不可用.+现在由自动选择的 Grok Imagine Video · Grok 代为生成视频/ },
  "zh-TW": { name: "生影片模型", auto: "自動", off: "關閉" },
  ja: { name: "動画生成", auto: "自動", off: "オフ" },
  de: { name: "Videoerzeugung", auto: "Automatisch", off: "Aus" },
};

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  test(engine + ": Video generation is picked in Settings › Images", async (t) => {
    assert(["chromium", "webkit"].includes(engine), "BROWSER must be chromium or webkit");
    const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
    const shots = [];
    t.after(async () => {
      if (process.env.ARTIFACT_DIR) {
        await fs.mkdir(process.env.ARTIFACT_DIR, { recursive: true });
        for (const [name, buf] of shots) await fs.writeFile(path.join(process.env.ARTIFACT_DIR, `${engine}-video-gen-${name}.png`), buf);
      }
      await browser.close();
    });
    const open = async (lang, posted, st, width) => {
      const context = await browser.newContext({ viewport: { width, height: 760 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      page.errors = [];
      page.on("pageerror", (e) => page.errors.push(e.message));
      await page.route("**/*", server(lang, posted, st));
      await page.goto("http://magpie.test/?view=settings&tab=models");
      await page.locator("#videoGenRow").waitFor();
      return page;
    };
    const reload = (page) => page.evaluate(() => fetch("/api/settings").then((r) => r.json()).then((s) => { prefs = s; state.settings = s; renderSettings(); }));

    for (const [lang, w] of Object.entries(words)) {
      for (const width of [1000, 360]) {
        await t.test(`${lang} at ${width}px: the row follows Image generation and shows magpie's pick`, async () => {
          const page = await open(lang, [], {}, width);
          const row = page.locator("#videoGenRow");
          assert.equal(await page.evaluate(() => document.querySelector("#imageGenRow").nextElementSibling?.id), "videoGenRow");
          assert.equal((await row.locator(".name").textContent()).trim(), w.name);
          assert.equal((await row.locator("button.rt-cond").textContent()).trim(), `${w.auto} · Grok Imagine Video · Grok`);
          const fit = await page.evaluate(() => {
            const r = document.querySelector("#videoGenRow"), list = document.querySelector("#imagesList").getBoundingClientRect(), b = r.getBoundingClientRect();
            return { inList: b.left >= list.left - 1 && b.right <= list.right + 1, scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
          });
          assert.deepEqual(fit, { inList: true, scroll: 0 });
          shots.push([`${lang}-${width}`, await page.screenshot({ fullPage: true })]);
          assert.deepEqual(page.errors, []);
          await page.context().close();
        });
      }
      if (!w.follows) continue;

      await t.test(`${lang}: a model is picked and kept, and Off is its own`, async () => {
        const posted = [], st = {};
        const page = await open(lang, posted, st, 1000);
        const row = page.locator("#videoGenRow");
        const where = () => page.evaluate(() => [scrollX, scrollY, document.scrollingElement.scrollTop, document.querySelector("main")?.scrollTop ?? 0]);
        const click = async (loc) => {
          const b = await loc.boundingBox();
          await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        };
        const before = await where();
        await click(row.locator("button.rt-cond"));
        await page.locator("#pop").waitFor({ state: "visible" });
        const items = await page.locator("#list li:not(.group)").allInnerTexts();
        assert(items[0].startsWith(w.auto) && items[0].includes("Grok Imagine Video · Grok"), items.join(" | "));
        assert(items[1].startsWith(w.off), items.join(" | "));
        assert.equal(items.filter((x) => x.includes("Grok Imagine Video")).length, 3, items.join(" | "));
        await click(page.locator("#list li:not(.group)", { hasText: "Grok Imagine Video 1.5" }));
        await page.waitForFunction(() => document.querySelector("#videoGenRow button.rt-cond")?.textContent.trim() === "Grok Imagine Video 1.5 · Grok");
        assert.equal(posted.at(-1).videoGen, "grok/grok-imagine-video-1.5");
        assert.equal(posted.at(-1).imageGen, "");
        assert.deepEqual(await where(), before, "the clicks moved nothing");

        // another setting saved sends the pick as it was
        const n = posted.length;
        await Promise.all([
          page.waitForResponse((r) => new URL(r.url()).pathname === "/api/settings" && r.request().method() === "POST"),
          page.evaluate(() => savePrefs({ ...prefsKeep(prefs), noStats: true })),
        ]);
        assert.equal(posted.length, n + 1);
        assert.equal(posted.at(-1).videoGen, "grok/grok-imagine-video-1.5");

        // Image generation off: a picked video model still makes videos,
        // and Image generation's row speaks of images only
        st.imageGen = "off";
        await reload(page);
        await page.waitForFunction((s) => document.querySelector("#imageGenRow .sub")?.textContent === s, w.imagesOff);
        assert.equal((await row.locator("button.rt-cond").textContent()).trim(), "Grok Imagine Video 1.5 · Grok");

        // left automatic, video follows Image generation's Off, as before
        st.videoGen = "";
        await reload(page);
        await page.waitForFunction((s) => document.querySelector("#imageGenRow .sub")?.textContent === s, w.bothOff);
        assert.equal((await row.locator("button.rt-cond").textContent()).trim(), `${w.auto} · ${w.off}`);
        assert.match(await row.locator(".sub").first().textContent(), w.follows);

        // Off, picked with Image generation on, turns videos off on its own
        st.imageGen = "";
        await reload(page);
        await click(row.locator("button.rt-cond"));
        await page.locator("#pop").waitFor({ state: "visible" });
        await click(page.locator("#list li:not(.group)").filter({ hasText: new RegExp(`^${w.off}`) }));
        await page.waitForFunction((off) => document.querySelector("#videoGenRow button.rt-cond")?.textContent.trim() === off, w.off);
        assert.deepEqual([posted.at(-1).imageGen, posted.at(-1).videoGen], ["", "off"]);

        // a pick magpie can't find any more is said, with what stands in
        Object.assign(st, { imageGen: "", videoGen: "gone/clip-9", missing: "gone/clip-9" });
        await reload(page);
        await page.locator("#videoGenRow .video-gen-missing").waitFor();
        assert.match(await row.locator(".video-gen-missing").textContent(), w.missing);
        assert.match((await row.locator("button.rt-cond").textContent()).trim(), /^gone\/clip-9 · /);
        assert.deepEqual(page.errors, []);
        await page.context().close();
      });
    }
  });
}
