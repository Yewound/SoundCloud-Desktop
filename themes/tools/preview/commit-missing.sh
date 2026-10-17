#!/usr/bin/env bash
set -uo pipefail

base=$(git rev-parse HEAD)
app="${RUNNER_TEMP:-/tmp}/app"

if ! (cd desktop && pnpm install --frozen-lockfile && pnpm exec vite build --outDir "$app" --emptyOutDir); then
  echo "::warning::app build failed, themes without a preview stay unpublished"
  exit 0
fi

dirs=()
for id in $IDS; do
  dirs+=("themes/$id")
done
node --experimental-strip-types themes/tools/preview/render.mjs --dist "$app" "${dirs[@]}" ||
  echo "::warning::some previews failed to render"

git add -- themes/*/preview.webp
if git diff --cached --quiet; then
  exit 0
fi
git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -q -m "themes: render previews for $IDS"
if ! git push -q origin HEAD:main; then
  echo "::warning::main moved, previews are rendered on the next run"
  git reset -q --hard "$base"
fi
