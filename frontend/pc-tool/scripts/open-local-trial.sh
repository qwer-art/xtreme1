#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
url=http://127.0.0.1:3200/local-trial
cache=${XDG_CACHE_HOME:-$HOME/.cache}/xtreme1
mkdir -p "$cache"
exec 9>"$cache/start.lock"
flock -w 30 9
ready() { curl --noproxy '*' -fsS --max-time 2 "$url" 2>/dev/null | grep -q 'Point Cloud Tool - Xtreme1'; }
if ! ready; then
    if ! command -v node >/dev/null; then
        export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
        . "$NVM_DIR/nvm.sh"
    fi
    nohup node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3200 --strictPort </dev/null >"$cache/vite.log" 2>&1 9>&- &
    server=$!
    for attempt in {1..60}; do
        ready && break
        kill -0 "$server" 2>/dev/null || break
        sleep .25
    done
    if ! ready; then
        notify-send 'Xtreme1' "启动失败，请查看 $cache/vite.log" || true
        exit 1
    fi
fi
exec 9>&-
exec google-chrome --app="$url"