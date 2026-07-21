#!/usr/bin/env bash
# FintasTech - one-command launcher for the FULL stack.
# EDUCATIONAL / RESEARCH USE ONLY. NOT INVESTMENT ADVICE.
#
# One command boots everything:
#   1) Python venv + backend deps  ->  FastAPI on :8000
#   2) Frontend deps               ->  Next.js on :3000
#   3) Local Hardhat chain on :8545 + auto-deploys the contracts
#      (MockUSDC / SignalRegistry / Vault) and syncs addresses to the
#      frontend, so the /vault page works out of the box.
#   4) Opens http://localhost:3000 in your browser.
#
# Usage:
#   ./start.sh              # full stack (backend + frontend + local chain)
#   ./start.sh --no-chain   # app only, skip the blockchain (faster)
#   ./stop.sh               # stop everything we started
#
# All PIDs are written to .run/ so start.sh is idempotent: re-running it
# first stops whatever it previously started.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

mkdir -p .run logs data

BACKEND_PORT=8000
FRONTEND_PORT=3000
CHAIN_PORT=8545

WITH_CHAIN=1
for arg in "$@"; do
  case "$arg" in
    --no-chain|--app-only) WITH_CHAIN=0 ;;
  esac
done

banner() {
  printf '\n\033[1;35m%s\033[0m\n' "==============================================="
  printf '\033[1;35m FintasTech - Research Lab (paper-trading only)\033[0m\n'
  printf '\033[1;33m EDUCATIONAL USE ONLY. NOT INVESTMENT ADVICE.\033[0m\n'
  printf '\033[1;35m%s\033[0m\n\n' "==============================================="
}

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$1" -sTCP:LISTEN -P -n >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q ":$1"
    return $?
  fi
  return 1
}

kill_prev() {
  local f="$1"
  if [ -f "$f" ]; then
    local pid
    pid="$(cat "$f" 2>/dev/null || echo "")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$f"
  fi
}

banner
kill_prev .run/backend.pid
kill_prev .run/frontend.pid
kill_prev .run/chain.pid

# ---------- [1/4] Python backend deps ----------
if [ ! -d ".venv" ]; then
  echo "[1/4] Creating Python virtualenv (.venv)..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

if ! python -c "import fintastech" 2>/dev/null; then
  echo "[1/4] Installing backend dependencies..."
  pip install -q --upgrade pip
  pip install -q -e .
fi

# ---------- [2/4] Frontend deps ----------
if [ ! -d "frontend/node_modules" ]; then
  echo "[2/4] Installing frontend dependencies (first run only, ~1 min)..."
  (cd frontend && npm install --silent)
fi

# ---------- [3/4] Backend + frontend ----------
if port_in_use "$BACKEND_PORT"; then
  echo "[3/4] Port ${BACKEND_PORT} is already in use."
  echo "      Run ./stop.sh first, or free the port, then retry."
  exit 1
fi
echo "[3/4] Starting FastAPI backend on :${BACKEND_PORT}..."
PYTHONPATH=src nohup uvicorn fintastech.api.main:app \
  --host 127.0.0.1 --port "$BACKEND_PORT" \
  > logs/backend.log 2>&1 &
echo $! > .run/backend.pid

backend_ok=0
for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "      ok backend healthy"
    backend_ok=1
    break
  fi
  sleep 0.5
done
if [ "$backend_ok" -ne 1 ]; then
  echo "      !! backend failed to come up. See logs/backend.log"
  tail -n 20 logs/backend.log || true
  exit 1
fi

if port_in_use "$FRONTEND_PORT"; then
  echo "[3/4] Port ${FRONTEND_PORT} is already in use."
  echo "      Stop the other process or free the port, then retry."
  exit 1
fi
echo "[3/4] Starting Next.js frontend on :${FRONTEND_PORT}..."
(cd frontend && nohup npm run dev -- --port "$FRONTEND_PORT" \
  > "$ROOT_DIR/logs/frontend.log" 2>&1 &
  echo $! > "$ROOT_DIR/.run/frontend.pid")

for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:${FRONTEND_PORT}" >/dev/null 2>&1; then
    echo "      ok frontend ready"
    break
  fi
  sleep 0.5
done

# ---------- [4/4] Local blockchain (optional) ----------
CHAIN_STATUS="skipped (--no-chain)"
if [ "$WITH_CHAIN" -eq 1 ]; then
  if port_in_use "$CHAIN_PORT"; then
    echo "[4/4] Port ${CHAIN_PORT} already in use - assuming a chain is running; skipping."
    CHAIN_STATUS="external (port ${CHAIN_PORT} was already taken)"
  else
    if [ ! -d "blockchain/node_modules" ]; then
      echo "[4/4] Installing blockchain dependencies (first run only, ~1-2 min)..."
      (cd blockchain && npm install --silent)
    fi
    echo "[4/4] Starting local Hardhat chain on :${CHAIN_PORT}..."
    (cd blockchain && nohup npm run node \
      > "$ROOT_DIR/logs/chain.log" 2>&1 &
      echo $! > "$ROOT_DIR/.run/chain.pid")

    chain_ok=0
    for _ in $(seq 1 60); do
      if curl -fs -X POST -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        "http://127.0.0.1:${CHAIN_PORT}" >/dev/null 2>&1; then
        chain_ok=1
        break
      fi
      sleep 0.5
    done

    if [ "$chain_ok" -eq 1 ]; then
      echo "[4/4] Deploying contracts (MockUSDC + SignalRegistry + Vault)..."
      if (cd blockchain && npm run deploy:local >> "$ROOT_DIR/logs/chain.log" 2>&1); then
        echo "      ok contracts deployed; addresses synced to the frontend"
        CHAIN_STATUS="running (chain :${CHAIN_PORT}, contracts deployed)"
      else
        echo "      !! deploy failed - /vault will show setup hints. See logs/chain.log"
        CHAIN_STATUS="chain up, deploy FAILED (see logs/chain.log)"
      fi
    else
      echo "      !! chain failed to come up. See logs/chain.log"
      CHAIN_STATUS="FAILED to start (see logs/chain.log)"
    fi
  fi
fi

# ---------- Summary ----------
printf '\n\033[1;32m%s\033[0m\n' "-----------------------------------------------"
printf '\033[1;32m All set! \033[0m\n\n'
printf '  App        : http://localhost:%s\n' "$FRONTEND_PORT"
printf '  API docs   : http://127.0.0.1:%s/docs\n' "$BACKEND_PORT"
printf '  Chain RPC  : http://127.0.0.1:%s  (%s)\n' "$CHAIN_PORT" "$CHAIN_STATUS"
printf '\n  Vault demo : add the "Hardhat Localhost" network to MetaMask\n'
printf '               (RPC http://127.0.0.1:%s, chainId 31337) and import\n' "$CHAIN_PORT"
printf '               Hardhat Account #0 - see README step 4 for the key.\n'
printf '\n  Stop everything with ./stop.sh\n'
printf '\033[1;32m%s\033[0m\n\n' "-----------------------------------------------"

# Open the browser (macOS / Linux) - best effort.
if command -v open >/dev/null 2>&1; then
  open "http://localhost:${FRONTEND_PORT}" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${FRONTEND_PORT}" 2>/dev/null || true
fi
