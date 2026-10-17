import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripRemoteCss } from '../../desktop/src/lib/themes/css-guard.ts';
import { asciiLower, tokenize } from '../../desktop/src/lib/themes/css-tokens.ts';
import { resolveCustomAssets } from '../../desktop/src/lib/themes/custom-assets.ts';

const BASE = 'http://127.0.0.1:4321/css-assets/';

const pipeline = (css) => resolveCustomAssets(stripRemoteCss(css).css, BASE);

function liveUrls(css) {
  const { tokens } = tokenize(css);
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'at-keyword' && asciiLower(token.value) === 'import') found.push('@import');
    if (token.type === 'url') found.push(token.value);
    if (token.type === 'function' && asciiLower(token.value) === 'url') {
      const next = tokens.slice(i + 1).find((item) => item.type !== 'whitespace');
      found.push(next?.type === 'string' ? next.value : 'url(');
    }
  }
  return found;
}

const BYPASSES = [
  '/* url(sc-assets/a*/) \na{content:"*/ @import url(https://x.test/i.css); b{background:url(https://x.test/leak)} /*"}',
  'a{content:"url(assets/*x)"}\nb{content:"*/ c{background:url(https://x.test/leak)} d{content:\\"x"}',
  '/* url("sc-assets/a*/") */ a{content:"*/ b{background:url(https://x.test/leak)} /*"}',
  'a{content:"url(sc-assets/*)"} b{content:"*/ @import \'https://x.test/i.css\'; /*"}',
  'a{background:url(sc-assets/a"b)} c{content:"\\"; d{background:url(https://x.test/leak)} e{content:\\""}',
  "a{background:url('sc-assets/a\\'b')} c{content:\"'; d{background:url(https://x.test/leak)}\"}",
];

test('custom css bypasses through the asset rewrite stay dead', () => {
  for (const css of BYPASSES) {
    const live = liveUrls(pipeline(css));
    assert.deepEqual(
      live.filter((value) => value === '@import' || !value.startsWith(BASE)),
      [],
      css,
    );
  }
});

test('asset urls resolve only outside strings and comments', () => {
  const css =
    'a{background:url(sc-assets/bg.png)} b{background:url( "assets/x-1.webp" )} ' +
    'c{content:"url(sc-assets/no.png)"} /* url(sc-assets/no.png) */ d{background:URL(SC-ASSETS/up.PNG)}';
  assert.equal(
    pipeline(css),
    `a{background:url("${BASE}bg.png")} b{background:url("${BASE}x-1.webp")} ` +
      'c{content:"url(sc-assets/no.png)"} /* url(sc-assets/no.png) */ ' +
      `d{background:url("${BASE}up.PNG")}`,
  );
});

test('odd asset names are left alone', () => {
  for (const css of [
    'a{background:url(sc-assets/..)}',
    'a{background:url(sc-assets/a/b.png)}',
    'a{background:url(sc-assets/.hidden.png)}',
    'a{background:url("sc-assets/a%2Fb.png")}',
    'a{background:url(sc-assets/)}',
  ]) {
    assert.equal(resolveCustomAssets(css, BASE), css);
  }
});
