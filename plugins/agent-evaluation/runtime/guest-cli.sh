#!/bin/sh
# Trusted diagnostic target only. No model, network, user configuration or host path.
case "$1" in
  --version) printf 'ae-offline-fake-cli 1\n'; exit 0 ;;
  echo)
    shift
    printf 'ENV:%s:%s:%s:%s\n' "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$PATH"
    for argument do
      printf 'ARG:'
      printf '%s' "$argument" | base64 | tr -d '\n'
      printf '\n'
    done
    printf 'STDIN:'
    cat
    test ! -e /ae/work/injected || exit 9
    ;;
  binary) cat ;;
  chunks)
    printf '{"final":"'
    sleep 0.2
    printf '中文🙂"}\n'
    printf 'diagnostic stderr\n' >&2
    sleep 2
    ;;
  waiting)
    printf 'waiting-input\n' >&2
    mkfifo /ae/work/answer
    IFS= read -r answer < /ae/work/answer
    ;;
  artifacts-*)
    case "$1" in
      artifacts-pass|artifacts-crash) printf '{"answer":42}\n' > result.json ;;
      *) printf '{"answer":0}\n' > result.json ;;
    esac
    printf 'changed\n' > old.txt
    rm deleted.txt
    printf 'included ignored\n' > .ignored
    printf 'untracked\n' > new.txt
    case "$1" in
      artifacts-tamper) printf 'all tests pass\n' > tests.txt; printf '{"pass":true}\n' > report.json ;;
      artifacts-missing) rm result.json ;;
      artifacts-link) ln -s /etc/passwd escaped ;;
      artifacts-special) mkfifo special ;;
      artifacts-limit) dd if=/dev/zero of=huge bs=1024 count=1 2>/dev/null ;;
    esac
    test ! -e /ae/hidden-fixture && test ! -e /ae/platform-results || exit 19
    printf 'all tests pass (untrusted self-report)\n'
    ;;
  empty) exit 0 ;;
  failure) printf 'expected failure\n' >&2; exit 7 ;;
  *) printf 'unknown diagnostic mode\n' >&2; exit 2 ;;
esac
