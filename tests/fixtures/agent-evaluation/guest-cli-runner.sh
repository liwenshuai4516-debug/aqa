#!/bin/sh
# Single-use trusted fixture protocol; stdin is control only, target gets a separate file.
# This is a transport diagnostic, not authentication against a malicious root guest.
set -eu
export PATH=/bin
umask 077
nonce=$1
mkdir /ae/home /ae/config /ae/cache /ae/work
cd /ae/work
frame() {
  while ! mkdir /ae/frame-lock 2>/dev/null; do sleep 0.01; done
  printf '\nAE1:%s:%s:%s\n' "$nonce" "$1" "$2"
  rmdir /ae/frame-lock
}
readCount=0
read_line() {
  IFS= read -r line || exit 21
  readCount=$((readCount + 1))
  frame ack "$readCount"
}
fail() { frame error "$1"; exit 22; }
frame ready ''
# Encoded text is data only; no eval, sh -c or reconstructed command string.
read_line
[ "$line" = AE1 ] || fail protocol
read_line
case "$line" in ''|*[!0-9]*) fail count ;; esac
[ "$line" -le 16 ] || fail count
count=$line
set --
size=0
while [ "$count" -gt 0 ]; do
  read_line
  case "$line" in A:*) encoded=${line#A:} ;; *) fail argument ;; esac
  [ "${#encoded}" -le 1368 ] || fail argument_size
  printf '%s' "$encoded" | base64 -d > /ae/argument || fail base64
  # Shell argv cannot contain NUL. The host rejects it too; enforce it at receiver.
  bytes=$(wc -c < /ae/argument)
  [ "$bytes" -le 1024 ] || fail argument_size
  [ "$(tr -d '\000' < /ae/argument | wc -c)" -eq "$bytes" ] || fail argument_nul
  size=$((size + bytes))
  [ "$size" -le 8192 ] || fail argument_budget
  argument=$(cat /ae/argument; printf .)
  argument=${argument%.}
  set -- "$@" "$argument"
  count=$((count - 1))
done
: > /ae/stdin
chunks=0
while :; do
  read_line
  [ "$line" = GO ] && break
  case "$line" in S:*) encoded=${line#S:} ;; *) fail stdin ;; esac
  [ "${#encoded}" -le 1368 ] || fail stdin_chunk
  chunks=$((chunks + 1))
  [ "$chunks" -le 64 ] || fail stdin_budget
  printf '%s' "$encoded" | base64 -d >> /ae/stdin || fail base64
done
[ "$(wc -c < /ae/stdin)" -le 65536 ] || fail stdin_budget
version=$(env -i PATH=/bin /bin/sh /ae/target --version)
[ "$version" = 'ae-offline-fake-cli 1' ] || fail version
frame version "$(printf '%s' "$version" | base64 | tr -d '\n')"
frame initial "$(printf '%s' "$(ls -A /ae/work)" | base64 | tr -d '\n')"
mkfifo /ae/stdout /ae/stderr
stream() {
  channel=$1
  exec 4< /ae/"$channel"
  while :; do
    dd bs=512 count=1 <&4 > /ae/chunk-"$channel" 2>/dev/null
    [ -s /ae/chunk-"$channel" ] || break
    frame "$channel" "$(base64 < /ae/chunk-"$channel" | tr -d '\n')"
  done
  frame "$channel"-eof ''
}
stream stdout &
out=$!
stream stderr &
err=$!
# Execute an argv vector with a frozen environment; target stdin never sees control records.
env -i PATH=/bin HOME=/ae/home XDG_CONFIG_HOME=/ae/config XDG_CACHE_HOME=/ae/cache \
  /bin/sh /ae/target "$@" < /ae/stdin > /ae/stdout 2> /ae/stderr &
target=$!
frame started "$target"
set +e
wait "$target"
code=$?
set -e
wait "$out"
wait "$err"
frame exit "$code"
# EOF/exit from the target is not whole-VM stop. Keep the control process alive for host stop.
while :; do sleep 1; done
