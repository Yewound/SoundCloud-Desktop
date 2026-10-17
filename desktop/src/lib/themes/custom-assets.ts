import { normalizeUrlValue } from './css-guard.ts';
import { asciiLower, tokenize } from './css-tokens.ts';

const ASSET_VALUE = /^(?:sc-)?assets\/([a-z0-9][a-z0-9._-]*)$/i;

export function resolveCustomAssets(css: string, base: string): string {
  const { tokens } = tokenize(css);
  let out = '';
  let last = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let value = token.type === 'url' ? token.value : null;
    let end = token.end;
    if (token.type === 'function' && asciiLower(token.value) === 'url') {
      let next = i + 1;
      while (tokens[next]?.type === 'whitespace') next++;
      const string = tokens[next++];
      while (tokens[next]?.type === 'whitespace') next++;
      if (string?.type === 'string' && tokens[next]?.type === ')') {
        value = string.value;
        end = tokens[next].end;
        i = next;
      }
    }
    const name = value === null ? undefined : ASSET_VALUE.exec(normalizeUrlValue(value))?.[1];
    if (!name) continue;
    out += `${css.slice(last, token.start)}url("${base}${name}")`;
    last = end;
  }
  return out + css.slice(last);
}
