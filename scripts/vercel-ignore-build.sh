#!/usr/bin/env bash
set -u

# Vercel: exit 0 skips the build; exit 1 builds. Compare with the last
# successful deployment so a multi-commit push cannot hide frontend changes.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [[ -z "$base" ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "Build: no previous deployment commit available."
  exit 1
fi

if git diff --quiet "$base" HEAD -- \
  app components lib public src styles \
  package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc \
  next.config.mjs postcss.config.mjs tsconfig.json \
  middleware.ts middleware.js proxy.ts proxy.js \
  instrumentation.ts instrumentation.js \
  vercel.json .vercelignore scripts/vercel-ignore-build.sh; then
  echo "Skip: no frontend or frontend build dependency changes."
  exit 0
fi

echo "Build: frontend files or build dependencies changed."
exit 1
