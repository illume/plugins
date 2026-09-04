# AI Assistant end-to-end tests

These Playwright tests run the production plugin in Headlamp v0.43.0 against a local KWOK v0.8.0 cluster. KWOK provides the control plane, simulated worker, demo workloads, and warning event while Headlamp runs in a separate Docker container.

The scenarios cover:

- viewing the KWOK-backed cluster in Headlamp;
- changing and persisting preview, Kubernetes tool, and Holmes service settings;
- configuring and executing native read-only Datadog, Splunk, Grafana, and Prometheus API tools;
- adding and removing the built-in mock testing model;
- chatting with the fixture-backed model;
- troubleshooting a pod with the scripted agent;
- exploring cluster workloads with the scripted agent.

## Run

Install Docker, kwokctl v0.8.0, kubectl, Node.js, and npm, then run:

```sh
npm ci
npm run e2e
```

The cross-platform TypeScript runner builds the plugin and Headlamp image, creates the KWOK cluster,
starts real Prometheus and Grafana containers, runs Headlamp and Chromium, and removes all containers
and the cluster afterward. Datadog and Splunk use provider-specific local API fixtures because their
hosted/licensed products cannot run as portable local test dependencies. Set `KEEP_E2E_CLUSTER=true`
to retain the KWOK cluster for debugging. Each run writes local, untracked screenshots to
`e2e/screenshots`.

`npm run e2e:playwright` runs only the Playwright scenarios against an already running Headlamp instance. It does not build Headlamp or create a cluster. Set `HEADLAMP_URL` if Headlamp is not available at `http://127.0.0.1:4466`.
