import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions,
  isCleanText,
  isThemePath,
  sniffAssetType,
  THEME_ID,
} from '../../desktop/src/lib/themes/rules.ts';

const bytes = (...parts) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)));

test('compareVersions compares numbers, not strings', () => {
  assert.ok(compareVersions('8.10.0', '8.6.0') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('2.3.4', '2.3.4'), 0);
  assert.ok(compareVersions('10.0.0', '9.99.99') > 0);
  assert.ok(compareVersions('1.2.10', '1.2.9') > 0);
  assert.ok(compareVersions('123456789012345678901.0.0', '123456789012345678900.0.0') > 0);
});

test('isCleanText rejects bidi, zero width, controls and padding', () => {
  assert.equal(isCleanText('Midnight', 32), true);
  assert.equal(isCleanText('Глубокий синий', 140), true);
  assert.equal(isCleanText('abc‮def', 32), false);
  assert.equal(isCleanText('abc​def', 32), false);
  assert.equal(isCleanText('a\nb', 32), false);
  assert.equal(isCleanText('a b', 32), false);
  assert.equal(isCleanText(' padded', 32), false);
  assert.equal(isCleanText('', 32), false);
  assert.equal(isCleanText('x'.repeat(33), 32), false);
  assert.equal(isCleanText('x'.repeat(32), 32), true);
});

test('isThemePath accepts only theme files', () => {
  assert.equal(isThemePath('theme.css'), true);
  assert.equal(isThemePath('preview.webp'), true);
  assert.equal(isThemePath('preview.png'), true);
  assert.equal(isThemePath('assets/stars.svg'), true);
  assert.equal(isThemePath('assets/../theme.json'), false);
  assert.equal(isThemePath('assets/sub/a.png'), false);
  assert.equal(isThemePath('theme.json'), false);
  assert.equal(isThemePath('preview.jpg'), false);
  assert.equal(isThemePath('assets/A.png'), false);
});

test('THEME_ID shape', () => {
  assert.ok(THEME_ID.test('midnight'));
  assert.ok(THEME_ID.test('a-b'));
  assert.ok(!THEME_ID.test('ab'));
  assert.ok(!THEME_ID.test('-ab'));
  assert.ok(!THEME_ID.test('Midnight'));
});

test('sniffAssetType reads magic bytes', () => {
  assert.equal(sniffAssetType(bytes([0x89], 'PNG\r\n\x1a\n', [0, 0])), 'png');
  assert.equal(sniffAssetType(bytes([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(sniffAssetType(bytes('GIF89a', [1, 0])), 'gif');
  assert.equal(sniffAssetType(bytes('GIF87a')), 'gif');
  assert.equal(sniffAssetType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')), 'webp');
  assert.equal(sniffAssetType(bytes([0, 0, 0, 0x1c], 'ftypavif')), 'avif');
  assert.equal(sniffAssetType(bytes([0, 0, 0, 0x1c], 'ftypavis')), 'avif');
  assert.equal(sniffAssetType(bytes([0, 0, 0, 0x1c], 'ftypheic')), null);
  assert.equal(sniffAssetType(bytes('wOF2', [0, 1, 0, 0])), 'woff2');
  assert.equal(sniffAssetType(bytes('wOFF')), null);
  assert.equal(sniffAssetType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  assert.equal(sniffAssetType(bytes([0xef, 0xbb, 0xbf], '\n <?xml version="1.0"?><svg/>')), 'svg');
  assert.equal(sniffAssetType(bytes('<!-- x --><svg/>')), 'svg');
  assert.equal(sniffAssetType(bytes('<?xml version="1.0"?><html/>')), null);
  assert.equal(sniffAssetType(bytes('hello <svg/>')), null);
  assert.equal(sniffAssetType(bytes([0xff, 0xfe], '<\0s\0v\0g\0')), null);
  assert.equal(sniffAssetType(bytes('RIFF')), null);
  assert.equal(sniffAssetType(new Uint8Array()), null);
});
