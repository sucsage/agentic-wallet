#!/bin/sh
set -eu
IP=$(hostname -i | awk '{print $1}')
socat TCP-LISTEN:3000,bind=127.0.0.1,fork,reuseaddr TCP:web:3000 &
socat TCP-LISTEN:47821,bind="$IP",fork,reuseaddr TCP:127.0.0.1:47821 &
echo "================================================================"
echo " Desktop app: open the 'Open:' link printed below in your browser"
echo " (the token in it changes on every start)."
echo "================================================================"
exec bun run src/main.ts --no-open
