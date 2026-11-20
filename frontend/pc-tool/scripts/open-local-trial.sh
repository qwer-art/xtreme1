#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
url=http://127.0.0.1:3200/local-trial
cache=${XDG_CACHE_HOME:-$HOME/.cache}/xtreme1
mkdir -p "$cache"
exec 9>"$cache/start.lock"
flock -w 30 9
ready() { curl --noproxy '*' -fsS --max-time 2 "$url" 2>/dev/null | grep -q 'Point Cloud Tool - Xtreme1'; }
node_bin=$(command -v node || true)
if ! "${node_bin:-node}" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>/dev/null; then
    node_bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v22.22.2/bin/node"
    if [[ ! -x "$node_bin" ]]; then
        notify-send 'Xtreme1' '启动需要 Node 18 或以上；未找到本机 Node 22.22.2。' || true
        exit 1
    fi
fi
"$node_bin" scripts/generate-local-scene.cjs --ensure >"$cache/local-scene.log" 2>&1 || {
    notify-send 'Xtreme1' "Scene generation failed: $cache/local-scene.log" || true
    exit 1
}
if ! ready; then
    nohup "$node_bin" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3200 --strictPort </dev/null >"$cache/vite.log" 2>&1 9>&- &
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