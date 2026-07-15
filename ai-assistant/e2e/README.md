# AI Assistant end-to-end tests

These Playwright tests run the production plugin in Headlamp v0.43.0 on a local Kind cluster. KWOK v0.8.0 manages a simulated worker, demo workloads, and a warning event while Headlamp runs on Kind's real control-plane node.

The scenarios cover:

- viewing the KWOK-backed cluster in Headlamp;
- enabling the built-in mock testing model and mock testing agent;
- chatting with the fixture-backed model; and
- troubleshooting a pod with the scripted agent.

## Run

Install Docker, Kind, kubectl, Node.js, and npm, then run:

```sh
npm ci
npm run e2e
```

The cross-platform TypeScript runner builds the plugin and Headlamp image, creates the cluster, installs KWOK, runs Chromium, and deletes the cluster afterward. Set `KEEP_E2E_CLUSTER=true` to retain it for debugging. Screenshots are written to `e2e/screenshots`.
