import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inspectSvg, inspectThemeCss } from '../../desktop/src/lib/themes/css-guard.ts';
import {
  compareVersions,
  GITHUB_LOGIN,
  HEX_COLOR,
  isCleanText,
  SEMVER,
  SHA256,
  sniffAssetType,
  TEXT_LIMITS,
  THEME_ASSET_NAME,
  THEME_FONTS,
  THEME_ID,
  THEME_LANGS,
  THEME_LICENSES,
  THEME_LIMITS,
  THEME_PREVIEW_PATHS,
  THEME_RESERVED_IDS,
} from '../../desktop/src/lib/themes/rules.ts';
import { commitTime, tryGit } from './git.mjs';
import { dimensions } from './images.mjs';

const THEME_KEYS = [
  '$schema',
  'id',
  'name',
  'description',
  'version',
  'author',
  'license',
  'minApp',
  'accent',
  'background',
  'font',
];
const AUTHOR_KEYS = ['name', 'github'];
const REVOKED_KEYS = ['id', 'hash', 'reason'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && isCleanText(value, max);
const isVersion = (value) => typeof value === 'string' && SEMVER.test(value);
const decodeUtf8 = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function listThemes(root) {
  return readdirSync(join(root, 'themes'), { withFileTypes: true })
    .filter((item) => item.isDirectory() && item.name !== 'tools')
    .map((item) => item.name)
    .sort();
}

export function readRevoked(root) {
  try {
    const list = JSON.parse(readFileSync(join(root, 'themes', 'revoked.json'), 'utf8'));
    const valid =
      Array.isArray(list) &&
      list.every(
        (item) =>
          isObject(item) &&
          Object.keys(item).every((key) => REVOKED_KEYS.includes(key)) &&
          typeof item.id === 'string' &&
          THEME_ID.test(item.id) &&
          typeof item.hash === 'string' &&
          SHA256.test(item.hash) &&
          typeof item.reason === 'string',
      );
    return valid ? list : null;
  } catch {
    return null;
  }
}

function readLayout(dir, at, errors) {
  const names = readdirSync(dir).sort();
  const previews = [];
  const assets = [];
  for (const name of names) {
    const stat = lstatSync(join(dir, name));
    if (name === 'assets' && stat.isDirectory()) {
      for (const asset of readdirSync(join(dir, name)).sort()) {
        const file = lstatSync(join(dir, name, asset));
        if (!file.isFile()) errors.push(`${at}/assets/${asset}: assets/ must hold only plain files`);
        else if (!THEME_ASSET_NAME.test(asset)) errors.push(`${at}/assets/${asset}: bad file name`);
        else assets.push(asset);
      }
    } else if (!stat.isFile()) {
      errors.push(`${at}/${name}: only plain files and a flat assets/ are allowed`);
    } else if (THEME_PREVIEW_PATHS.includes(name)) {
      previews.push(name);
    } else if (name !== 'theme.json' && name !== 'theme.css') {
      errors.push(`${at}/${name}: unexpected file`);
    }
  }
  for (const required of ['theme.json', 'theme.css']) {
    if (!names.includes(required)) errors.push(`${at}/${required}: missing`);
  }
  if (previews.length !== 1) errors.push(`${at}: needs exactly one preview.webp or preview.png`);
  return errors.length > 0 ? null : { preview: previews[0], assets };
}

function checkDescription(description, bad) {
  if (!isObject(description)) return bad('description', 'must be an object of languages');
  const langs = Object.keys(description);
  if (langs.length < 1 || langs.length > THEME_LANGS.length) {
    bad('description', `needs 1-${THEME_LANGS.length} languages`);
  }
  for (const lang of langs) {
    if (!THEME_LANGS.includes(lang)) bad(`description.${lang}`, 'is not a supported language');
    else if (!isText(description[lang], TEXT_LIMITS.description)) {
      bad(`description.${lang}`, `must be 1-${TEXT_LIMITS.description} plain characters`);
    }
  }
}

function checkAuthor(author, bad) {
  if (!isObject(author)) return bad('author', 'must be an object with a name');
  for (const key of Object.keys(author)) {
    if (!AUTHOR_KEYS.includes(key)) bad(`author.${key}`, 'is not a known key');
  }
  if (!isText(author.name, TEXT_LIMITS.authorName)) {
    bad('author.name', `must be 1-${TEXT_LIMITS.authorName} plain characters`);
  }
  if (author.github !== undefined && !(typeof author.github === 'string' && GITHUB_LOGIN.test(author.github))) {
    bad('author.github', 'must be a GitHub login');
  }
}

function checkMeta(meta, at, folder, errors) {
  const bad = (field, rule) => {
    errors.push(`${at}/theme.json: ${field} ${rule}`);
  };
  if (!isObject(meta)) return bad('theme.json', 'must be an object');
  for (const key of Object.keys(meta)) {
    if (!THEME_KEYS.includes(key)) bad(key, 'is not a known key');
  }
  if (typeof meta.id !== 'string' || !THEME_ID.test(meta.id)) {
    bad('id', 'must be 3-32 characters of a-z, 0-9 and -');
  } else if (THEME_RESERVED_IDS.includes(meta.id)) {
    bad('id', 'is reserved');
  }
  if (meta.id !== folder) bad('id', `must equal the folder name "${folder}"`);
  if (!isText(meta.name, TEXT_LIMITS.name)) {
    bad('name', `must be 1-${TEXT_LIMITS.name} plain characters`);
  }
  checkDescription(meta.description, bad);
  if (!isVersion(meta.version)) bad('version', 'must look like 1.0.0');
  checkAuthor(meta.author, bad);
  if (!THEME_LICENSES.includes(meta.license)) {
    bad('license', `must be one of ${THEME_LICENSES.join(', ')}`);
  }
  if (meta.minApp !== undefined && !isVersion(meta.minApp)) bad('minApp', 'must look like 1.0.0');
  for (const key of ['accent', 'background']) {
    if (meta[key] !== undefined && !(typeof meta[key] === 'string' && HEX_COLOR.test(meta[key]))) {
      bad(key, 'must look like #1a2b3c in lowercase');
    }
  }
  if (meta.font !== undefined && !THEME_FONTS.includes(meta.font)) {
    bad('font', `must be one of ${THEME_FONTS.join(', ')}`);
  }
  if (meta.$schema !== undefined && typeof meta.$schema !== 'string') bad('$schema', 'must be a string');
}

function readMeta(dir, at, folder, errors) {
  let meta;
  try {
    meta = JSON.parse(decodeUtf8(readFileSync(join(dir, 'theme.json'))));
  } catch (error) {
    errors.push(`${at}/theme.json: cannot be read: ${error.message}`);
    return null;
  }
  const before = errors.length;
  checkMeta(meta, at, folder, errors);
  return errors.length === before ? meta : null;
}

function readCss(dir, at, assetNames, errors, warnings) {
  const bytes = readFileSync(join(dir, 'theme.css'));
  let css;
  try {
    css = decodeUtf8(bytes);
  } catch {
    errors.push(`${at}/theme.css: is not valid UTF-8`);
    return null;
  }
  const report = inspectThemeCss(css, assetNames);
  const format = (issue) =>
    `${at}/theme.css:${issue.line}:${issue.column} ${issue.code} ${issue.message}`;
  errors.push(...report.errors.map(format));
  warnings.push(...report.warnings.map(format));
  return { file: { path: 'theme.css', sha256: sha256(bytes), size: bytes.length }, used: report.assets };
}

function checkSvg(bytes, where, errors, warnings) {
  let text;
  try {
    text = decodeUtf8(bytes);
  } catch {
    errors.push(`${where}: is not valid UTF-8`);
    return;
  }
  const report = inspectSvg(text);
  errors.push(...report.errors.map((message) => `${where}: ${message}`));
  warnings.push(...report.warnings.map((message) => `${where}: svg-text ${message}`));
}

function readAssets(dir, at, names, used, errors, warnings) {
  if (names.length > THEME_LIMITS.assetsCount) {
    errors.push(`${at}/assets: more than ${THEME_LIMITS.assetsCount} files`);
  }
  let total = 0;
  const assets = [];
  for (const name of names) {
    const path = `assets/${name}`;
    const where = `${at}/${path}`;
    const bytes = readFileSync(join(dir, path));
    total += bytes.length;
    if (bytes.length > THEME_LIMITS.assetBytes) errors.push(`${where}: bigger than 1 MiB`);
    const extension = name.slice(name.lastIndexOf('.') + 1);
    const expected = extension === 'jpg' ? 'jpeg' : extension;
    if (sniffAssetType(bytes) !== expected) errors.push(`${where}: content is not ${expected}`);
    else if (expected === 'svg') checkSvg(bytes, where, errors, warnings);
    if (!used.includes(name)) errors.push(`${where}: not used in theme.css`);
    assets.push({ path, sha256: sha256(bytes), size: bytes.length });
  }
  if (total > THEME_LIMITS.assetsTotalBytes) errors.push(`${at}/assets: more than 3 MiB in total`);
  return assets;
}

function readPreview(dir, at, path, errors) {
  const where = `${at}/${path}`;
  const bytes = readFileSync(join(dir, path));
  const type = path === 'preview.png' ? 'png' : 'webp';
  const before = errors.length;
  if (sniffAssetType(bytes) !== type) errors.push(`${where}: content is not ${type}`);
  if (bytes.length > THEME_LIMITS.previewBytes) errors.push(`${where}: bigger than 256 KiB`);
  const size = dimensions(bytes);
  if (!size) {
    errors.push(`${where}: cannot read the image size`);
    return null;
  }
  const { width, height } = size;
  if (width < THEME_LIMITS.previewMinWidth || width > THEME_LIMITS.previewMaxWidth) {
    errors.push(
      `${where}: width ${width} is outside ${THEME_LIMITS.previewMinWidth}-${THEME_LIMITS.previewMaxWidth}`,
    );
  }
  const aspect = width / height;
  if (!(aspect >= THEME_LIMITS.previewMinAspect && aspect <= THEME_LIMITS.previewMaxAspect)) {
    errors.push(
      `${where}: ${width}x${height} is not ${THEME_LIMITS.previewMinAspect}-${THEME_LIMITS.previewMaxAspect} wide, 16:10 fits`,
    );
  }
  if (errors.length > before) return null;
  return { path, sha256: sha256(bytes), size: bytes.length, width, height };
}

function themeHash(css, assets, meta) {
  const files = assets.map((a) => [a.path, a.sha256]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const key = [css.sha256, files, meta.accent ?? null, meta.background ?? null, meta.font ?? null];
  return sha256(Buffer.from(JSON.stringify(key), 'utf8'));
}

function themeRev(root, at, buildRev) {
  const rev = tryGit(root, ['log', '-1', '--format=%H', buildRev, '--', at]);
  if (!rev) return buildRev;
  const current = tryGit(root, ['rev-parse', `${buildRev}:${at}`]);
  return current && tryGit(root, ['rev-parse', `${rev}:${at}`]) === current ? rev : buildRev;
}

function orderedDescription(description) {
  return Object.fromEntries(THEME_LANGS.filter((lang) => lang in description).map((lang) => [lang, description[lang]]));
}

export function loadTheme(dir, buildRev, previousEntry) {
  const folder = basename(dir);
  const at = `themes/${folder}`;
  const errors = [];
  const warnings = [];
  const failed = () => ({ entry: null, errors, warnings });

  const layout = readLayout(dir, at, errors);
  if (!layout) return failed();
  const meta = readMeta(dir, at, folder, errors);
  const css = readCss(dir, at, layout.assets, errors, warnings);
  const assets = readAssets(dir, at, layout.assets, css?.used ?? [], errors, warnings);
  const preview = readPreview(dir, at, layout.preview, errors);
  if (!meta || !css || !preview || errors.length > 0) return failed();

  const hash = themeHash(css.file, assets, meta);
  if (previousEntry && previousEntry.hash !== hash && isVersion(previousEntry.version)) {
    if (compareVersions(meta.version, previousEntry.version) <= 0) {
      errors.push(
        `${at}/theme.json: version must go up from ${previousEntry.version}, the files changed`,
      );
      return failed();
    }
  }

  const root = resolve(dir, '..', '..');
  const rev = buildRev ? themeRev(root, at, buildRev) : undefined;
  const entry = {
    id: meta.id,
    rev,
    name: meta.name,
    description: orderedDescription(meta.description),
    version: meta.version,
    author: meta.author.github
      ? { name: meta.author.name, github: meta.author.github }
      : { name: meta.author.name },
    license: meta.license,
    minApp: meta.minApp,
    accent: meta.accent,
    background: meta.background,
    font: meta.font,
    updated: rev ? commitTime(root, rev) : undefined,
    hash,
    size: css.file.size + assets.reduce((sum, asset) => sum + asset.size, 0),
    preview,
    css: css.file,
    assets,
  };
  return { entry, errors, warnings };
}
