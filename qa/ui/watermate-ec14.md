# WaterMate EC14 Manual Probe

This asset connects only to an already-launched, isolated WaterMate `1.0.0` window over a loopback CDP endpoint. It does not create profiles, read authentication data, inspect page text, or send a task by default.

Start the isolated client with a temporary `--user-data-dir`, `--remote-debugging-address=127.0.0.1`, and a port at least `8900`. Log in manually to the isolated window; never use a personal profile.

```bash
npm run test:agent-evaluation:watermate -- --cdp-url http://127.0.0.1:9333 --scenario observe
npm run test:agent-evaluation:watermate -- --cdp-url http://127.0.0.1:9333 --scenario input
```

`submit` and `stop` require `WATERMATE_EC14_ALLOW_SUBMIT=1` and a bounded task. They consume a top-level submission and therefore remain subject to the EC14 trial budget and evidence plan. Capture only the script's structured JSON result in the EC14 evidence record; do not archive screenshots, CDP payloads, DOM text, cookies, or the isolated profile.

`handoff` submits a bounded task, waits until the visible stop control appears, then waits up to two minutes for a human to end or take over the task. It does not click stop itself.

This probe supports controlled GUI observation. It does not establish a general WaterMate executor, a CLI integration, model usage accounting, or a completed EC14 evaluation.
