#!/usr/bin/env bash
# Daily corpus growth + retrain for the self-hosted StealthHumanizer.
#
# Runs the max-paper ingest (config.1m.json) against OpenAlex, builds the
# benchmark, and retrains the corpus style model. OpenAlex's free polite pool
# caps ~1000 credits/day; the ingest code backs off on HTTP 429, so a single
# run fetches as much of the 1M-target corpus as the day's budget allows and
# degrades gracefully. Across days this accumulates a large, high-quality
# (cited_by_count-ranked, OA, DOI'd) corpus.
#
# Safety:
#   - Aborts if free disk < 3GB (protects Vaultwarden + containers on the same box).
#   - Only replaces the live model when training PASSES its quality gates; the
#     previously-serving model is retained otherwise.
#   - Runs niced/ioniced to avoid starving the web app + Vaultwarden.
#
# Intended to be run by cron (ubuntu user), e.g. 17 1 * * *  (01:17 UTC daily).
set -uo pipefail

# Cron runs with a minimal PATH; make node/pm2 discoverable.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/.npm-global/bin"

APP_DIR="/opt/stealthhumanizer"
INGEST_CONFIG="$APP_DIR/data/papers/config.1m.json"
BENCH_CONFIG="$APP_DIR/data/papers/benchmark.q1-oa-10k.json"
TRAIN_CONFIG="$APP_DIR/data/models/train.q1-oa-10k.json"
MODEL="$APP_DIR/data/models/corpus-style-model.json"
PUBLIC_MODEL="$APP_DIR/public/corpus-style-model.json"
LOG="$APP_DIR/data/papers/daily-train.log"

mkdir -p "$(dirname "$LOG")"
exec >> "$LOG" 2>&1

echo "===== $(date -u +%FT%TZ) daily-train start ====="

# Disk guard (MB free).
AVAIL_MB=$(df --output=avail -BM / | tail -1 | tr -dc '0-9')
if [ "${AVAIL_MB:-0}" -lt 3000 ]; then
  echo "ABORT: low disk ${AVAIL_MB}MB free (<3GB guard). Skipping to protect co-hosted services."
  exit 0
fi

cd "$APP_DIR" || { echo "ABORT: $APP_DIR missing"; exit 0; }

# Fetch + benchmark + train (nice/ionice to stay polite on a shared box).
if nice -n 19 ionice -c 3 node scripts/papers/batch-download-and-train.mjs \
      "$INGEST_CONFIG" "$BENCH_CONFIG" "$TRAIN_CONFIG"; then
  if [ -s "$MODEL" ]; then
    cp "$MODEL" "$PUBLIC_MODEL"
    pm2 restart stealthhumanizer >/dev/null 2>&1 || true
    PC=$(python3 -c "import json,sys;print(json.load(open('$MODEL')).get('paperCount','?'))" 2>/dev/null || echo "?")
    echo "OK: model retrained and published (paperCount=$PC); app restarted."
  else
    echo "WARN: pipeline reported success but $MODEL is empty; keeping previous model."
  fi
else
  echo "NOTE: pipeline did not complete cleanly (often OpenAlex daily budget exhausted or quality gate not met). Previous model keeps serving; will retry next run."
fi

echo "===== $(date -u +%FT%TZ) daily-train done ====="
