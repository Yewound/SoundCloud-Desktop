import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { inspectThemeCss, rewriteThemeAssetUrls } from '../../../desktop/src/lib/themes/css-guard.ts';
import { THEME_LIMITS } from '../../../desktop/src/lib/themes/rules.ts';
import { listThemes } from '../theme.mjs';
import { launchChrome } from './chrome.mjs';
import { startServer } from './server.mjs';

const WIDTH = 1280;
const HEIGHT = 800;
const QUALITIES = [80, 70, 60, 50];
const READY_TIMEOUT_MS = 60_000;
const SETTLE_MS = 2500;
const MIME = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
};

const READY = `!!document.querySelector('[data-ui="main"] nav button') && document.fonts.status === 'loaded'`;
const STATE = `({ fonts: document.fonts.status, nav: document.querySelectorAll('[data-ui="main"] nav button').length, text: document.body.innerText.slice(0, 120) })`;
const OPEN_APPEARANCE = `document.querySelectorAll('[data-ui="main"] nav button')[1].click()`;
const FINISH = `(async () => {
  document.head.appendChild(window.__SC_PREVIEW_STYLE__);
  await document.fonts.ready;
  return [...window.__SC_PREVIEW_UNKNOWN__];
})()`;

const { values, positionals } = parseArgs({
  options: {
    dist: { type: 'string' },
    chrome: { type: 'string' },
    out: { type: 'string' },
    missing: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function findChrome() {
  if (values.chrome) return values.chrome;
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (existsSync('/ms-playwright')) {
    const build = readdirSync('/ms-playwright').find((name) => /^chromium-\d+$/.test(name));
    if (build) return `/ms-playwright/${build}/chrome-linux/chrome`;
  }
  return 'google-chrome';
}

const desktop = join(import.meta.dirname, '..', '..', '..', 'desktop');

function appVersion() {
  return JSON.parse(readFileSync(join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
}

function newsIds() {
  const source = readFileSync(join(desktop, 'src', 'lib', 'constants.ts'), 'utf8');
  const list = source.slice(source.indexOf('export const NEWS'));
  return [...list.slice(0, list.indexOf('];')).matchAll(/\bid: '([^']+)'/g)].map((match) => match[1]);
}

function themePayload(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
  const assetsDir = join(dir, 'assets');
  const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  const source = readFileSync(join(dir, 'theme.css'), 'utf8');
  const report = inspectThemeCss(source, assets);
  if (report.errors.length > 0) {
    const first = report.errors[0];
    throw new Error(`theme.css:${first.line}:${first.column} ${first.code} ${first.message}`);
  }
  const css = rewriteThemeAssetUrls(source, (name) => {
    const type = MIME[name.slice(name.lastIndexOf('.') + 1)];
    return `data:${type};base64,${readFileSync(join(assetsDir, name)).toString('base64')}`;
  });
  const settings = {
    accentColor: meta.accent ?? '#ff5500',
    bgPrimary: meta.background ?? '#08080a',
    interfaceFont: meta.font ?? 'inter',
    themePreset: 'custom',
    startupPage: 'settings',
    language: 'en',
    perfMode: 'beauty',
    perfModeUserSet: true,
    perfProbed: true,
  };
  return {
    css,
    appVersion: appVersion(),
    files: {
      'sc-settings.json': JSON.stringify({ state: settings, version: 0 }),
      'news.json': JSON.stringify({ state: { dismissed: newsIds() }, version: 1 }),
    },
  };
}

async function evaluate(browser, sessionId, expression) {
  const result = await browser.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function openPage(browser, origin) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  browser.listeners.add((message) => {
    if (message.sessionId !== sessionId || message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const local = request.url.startsWith(origin) || /^(data|blob):/.test(request.url);
    const method = local ? 'Fetch.continueRequest' : 'Fetch.failRequest';
    const params = local ? { requestId } : { requestId, errorReason: 'BlockedByClient' };
    browser.send(method, params, sessionId).catch(() => {});
  });
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await browser.send('Page.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function capture(browser, sessionId) {
  for (const quality of QUALITIES) {
    const shot = await browser.send(
      'Page.captureScreenshot',
      { format: 'webp', quality, captureBeyondViewport: false },
      sessionId,
    );
    const bytes = Buffer.from(shot.data, 'base64');
    if (bytes.length <= THEME_LIMITS.previewBytes) return bytes;
  }
  throw new Error('preview stays over 256 KiB');
}

async function renderTheme(browser, origin, id) {
  const { targetId, sessionId } = await openPage(browser, origin);
  try {
    await browser.send('Page.navigate', { url: `${origin}/settings?theme=${id}` }, sessionId);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!(await evaluate(browser, sessionId, READY).catch(() => false))) {
      if (Date.now() > deadline) {
        const state = await evaluate(browser, sessionId, STATE);
        throw new Error(`the app did not render settings: ${JSON.stringify(state)}`);
      }
      await sleep(250);
    }
    await evaluate(browser, sessionId, OPEN_APPEARANCE);
    await sleep(SETTLE_MS);
    const unknown = await evaluate(browser, sessionId, FINISH);
    if (values.verbose) console.log(`${id}: unanswered commands ${unknown.join(', ') || 'none'}`);
    return await capture(browser, sessionId);
  } finally {
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

const root = resolve(import.meta.dirname, '..', '..', '..');
const hasPreview = (dir) => existsSync(join(dir, 'preview.webp')) || existsSync(join(dir, 'preview.png'));
const all = positionals.length > 0 ? positionals : listThemes(root).map((id) => join(root, 'themes', id));
const dirs = all.map((dir) => resolve(dir)).filter((dir) => !values.missing || !hasPreview(dir));

if (values.list) {
  console.log(dirs.map((dir) => basename(dir)).join(' '));
  process.exit(0);
}
if (!values.dist) {
  console.error('usage: render.mjs --dist <vite build> [--chrome <bin>] [--out <dir>] [--missing] [theme dir...]');
  process.exit(1);
}

const dist = resolve(values.dist);
const payloads = new Map();
let failed = 0;
for (const dir of dirs) {
  try {
    payloads.set(basename(dir), themePayload(dir));
  } catch (error) {
    failed++;
    console.error(`${basename(dir)}: ${error.message}`);
  }
}

const server = await startServer(dist, payloads);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchChrome(findChrome());
try {
  for (const dir of dirs) {
    const id = basename(dir);
    if (!payloads.has(id)) continue;
    try {
      const bytes = await renderTheme(browser, origin, id);
      const target = values.out ? join(resolve(values.out), `${id}.webp`) : join(dir, 'preview.webp');
      writeFileSync(target, bytes);
      console.log(`${id}: ${target} ${(bytes.length / 1024).toFixed(1)} KiB`);
    } catch (error) {
      failed++;
      console.error(`${id}: ${error.message}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed > 0 ? 1 : 0);
