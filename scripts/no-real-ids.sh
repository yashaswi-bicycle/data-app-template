#!/usr/bin/env bash
# Guards against real tenant/customer model ids or metric/dimension names
# leaking into this public kit. See AGENTS.md invariants.
#
# Usage:
#   scripts/no-real-ids.sh
#   KIT_FORBIDDEN_IDS='id_one|id_two' scripts/no-real-ids.sh
#
# KIT_FORBIDDEN_IDS is a pipe-separated extended-regex of names that must not
# appear anywhere in the repo (template/ and examples/ included; node_modules/
# excluded). It defaults to empty, which skips that check. Whatever
# KIT_FORBIDDEN_IDS is set to, this script always also fails if
#   - a fixture under spec/examples, profiles/examples, template/ or examples/
#     declares a "model" id that does not start with "m_" — real model ids from
#     the service never look like that; or
#   - SQL anywhere under template/ or examples/ (docs, manifests, code) reads
#     FROM a model that is not "m_..." or a "<placeholder>".

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

status=0

if [ -n "${KIT_FORBIDDEN_IDS:-}" ]; then
  hits="$(git grep -iEn "${KIT_FORBIDDEN_IDS}" -- . ':!node_modules' ':!scripts/no-real-ids.sh' || true)"
  if [ -n "$hits" ]; then
    echo "no-real-ids: forbidden pattern matched (KIT_FORBIDDEN_IDS='${KIT_FORBIDDEN_IDS}'):"
    echo "$hits"
    status=1
  fi
fi

hand_built=()
for dir in template examples; do
  [ -d "$dir" ] && hand_built+=("$dir")
done

bad_models="$(
  grep -rhoE --exclude-dir=node_modules --exclude-dir=dist --include='*.json' \
      '"model"[[:space:]]*:[[:space:]]*"[^"]*"' spec/examples profiles/examples ${hand_built[@]+"${hand_built[@]}"} 2>/dev/null \
    | sed -E 's/.*"model"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' \
    | grep -vE '^(m_|<)' || true
)"
if [ -n "$bad_models" ]; then
  echo "no-real-ids: model id(s) under spec/examples, profiles/examples, template/ or examples/ do not start with m_:"
  echo "$bad_models"
  status=1
fi

if [ "${#hand_built[@]}" -gt 0 ]; then
  bad_from="$(
    grep -rnoE --exclude-dir=node_modules --exclude-dir=dist \
        --include='*.md' --include='*.json' --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.sql' \
        '\bFROM[[:space:]]+[^[:space:],;)"`]+' "${hand_built[@]}" 2>/dev/null \
      | grep -vE ':FROM[[:space:]]+(m_|<)' || true
  )"
  if [ -n "$bad_from" ]; then
    echo "no-real-ids: SQL under template/ or examples/ reads FROM a model that is not m_... or a <placeholder>:"
    echo "$bad_from"
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "no-real-ids: ok"
fi

exit "$status"
