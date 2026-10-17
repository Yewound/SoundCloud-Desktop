import { THEME_STYLE_ID } from './apply';

type ProbeRoot = 'main' | 'tray';

const HOOKS: Record<ProbeRoot, string[]> = {
  main: ['app', 'main', 'player', 'sidebar'],
  tray: ['tray'],
};
const ZOOM_TARGETS = new Set(['html', 'body', 'app']);
const HIT_TARGETS = new Set(['main', 'player']);
const MIN_SIZE = 8;
const MIN_OPACITY = 0.2;

function ready(): boolean {
  return document.visibilityState === 'visible' && window.innerWidth > 0 && window.innerHeight > 0;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function whenShown() {
  do {
    while (!ready()) {
      await new Promise<void>((resolve) => {
        const done = () => {
          document.removeEventListener('visibilitychange', done);
          window.removeEventListener('resize', done);
          resolve();
        };
        document.addEventListener('visibilitychange', done);
        window.addEventListener('resize', done);
      });
    }
    await nextFrame();
    await nextFrame();
  } while (!ready());
}

function targets(root: ProbeRoot): [string, Element][] {
  const found: [string, Element][] = [
    ['html', document.documentElement],
    ['body', document.body],
  ];
  for (const hook of HOOKS[root]) {
    const element = document.querySelector(`[data-ui="${hook}"]`);
    if (element) found.push([hook, element]);
  }
  return found;
}

function visibleArea(rect: DOMRect): boolean {
  const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
  const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return width >= MIN_SIZE && height >= MIN_SIZE;
}

function passing(list: [string, Element][]): Set<string> {
  const passed = new Set<string>();
  for (const [name, element] of list) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const zoom = Number.parseFloat(style.getPropertyValue('zoom')) || 1;
    const checks: [string, boolean][] = [
      ['display', style.display !== 'none'],
      ['visibility', style.visibility === 'visible'],
      ['opacity', Number.parseFloat(style.opacity) >= MIN_OPACITY],
      ['pointer-events', style.pointerEvents !== 'none'],
      ['rect', visibleArea(rect)],
    ];
    if (ZOOM_TARGETS.has(name)) checks.push(['zoom', zoom >= 0.5 && zoom <= 2]);
    if (HIT_TARGETS.has(name)) {
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      checks.push(['hit', hit !== null && element.contains(hit)]);
    }
    for (const [check, ok] of checks) if (ok) passed.add(`${name}:${check}`);
  }
  return passed;
}

export async function probeTheme(root: ProbeRoot): Promise<string[]> {
  await whenShown();
  const style = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  const sheet = style?.sheet;
  if (!sheet) return [];
  const list = targets(root);
  const themed = passing(list);
  sheet.disabled = true;
  let baseline: Set<string>;
  try {
    baseline = passing(list);
  } finally {
    sheet.disabled = false;
  }
  return [...baseline].filter((check) => !themed.has(check));
}
