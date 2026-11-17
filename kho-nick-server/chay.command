#!/bin/bash
# Bấm đúp (macOS) hoặc chạy ./chay.command (Linux). Không cần cd.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Chưa cài Node.js: https://nodejs.org"; read -r -p "Enter để thoát"; exit 1; }
[ -f .env ] || cp .env.example .env
OPEN_BROWSER=1 node server.js
