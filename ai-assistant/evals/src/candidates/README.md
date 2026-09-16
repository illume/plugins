# Candidates

Candidate adapters normalize every system being evaluated behind one invocation contract. This lets the trial runner treat deterministic controls and the real Headlamp CLI alike while keeping subprocess, provider, and environment handling out of the runner.

Start with:

- [`candidateAdapter.ts`](candidateAdapter.ts) for candidate-visible inputs and normalized results.
- [`headlampCli.ts`](headlampCli.ts) for the real CLI subprocess boundary and sanitized telemetry ingestion.
- [`scripted.ts`](scripted.ts) for deterministic reference, failure, and malformed controls.
- [`providerDetection.ts`](providerDetection.ts) for parsing provider discovery output.
- [`referenceQualification.ts`](referenceQualification.ts) for fail-closed startup, health,
  fixed-submission parity, and cleanup controls shared by external reference adapters.

Candidates receive the candidate packet, retrieved observations, and explicitly supplied ephemeral environment only. Protected evaluator truth must never cross this boundary.

The reference qualification harness is not evidence that HolmesGPT or K8sGPT is qualified.
Each pinned implementation remains ineligible until its concrete adapter passes every control.

## kubectl-ai Supplied-Evidence Candidate

[`kubectlAiAdapter.ts`](kubectlAiAdapter.ts) runs the unmodified v0.0.31 release
against harness-supplied observations. It does not grant cluster access, execute
repairs, or change the frozen comparison roster. It shares the diagnosis
instruction with HolmesGPT and extracts the model's exact JSON from native
session history, not terminal formatting or an adapter-authored interpretation.

Build the shell-free Linux ARM64 image from the ai-assistant directory:

```sh
docker build --platform linux/arm64 -f evals/images/kubectl-ai/Dockerfile \
    -t headlamp-eval-kubectl-ai:0.0.31 evals/images/kubectl-ai
docker image inspect headlamp-eval-kubectl-ai:0.0.31 --format '{{.Id}}'
```

Use the resulting immutable image ID, not its tag. Only this image recipe is
supported: a digest pins identity, but does not prove that an arbitrary image
has no tools. The recipe checks the release archive and binary hashes and
contains neither bash nor kubectl. The adapter mounts only a new private
session directory, passes Azure credentials by environment, disables privilege
escalation, and bounds runtime and container cleanup. It never mounts a
kubeconfig, repository, Docker socket, or existing user session.

With `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` configured, run from evals:

```sh
npm run eval -- --execute real --profile local-minikube --candidate kubectl-ai \
    --kubectl-ai-image sha256:<image-id> --kubectl-ai-model <azure-deployment> \
    --case core-pvc-storageclass-missing-v1 --case core-pvc-storageclass-healthy-v1
```

The same flags apply when kubectl-ai is a baseline or when rerunning its trial.
`--kubectl-ai-timeout-ms` may shorten the default 90000ms limit. This release can
hang after an Azure 401, so a deadline is mandatory. Missing or mismatched
session history, permission requests, tool calls, native errors, and process
failures cannot pass. Unknown tool observability remains unknown. Token usage
is omitted: the tested Azure path exposes no usage in its trace or session
files. Do not interpret missing telemetry as zero cost.

### Pinned Controls

The [qualification receipt](../../registrations/kubectl-ai-qualification-20260915.json)
records the reviewed image and binary hashes, exact fixed-submission transport
using the same normalizer as runtime, input parity, absent shell and kubectl
executables, provider-failure timeout, and cleanup. Regression controls include
changed evidence IDs, wrong input, missing/malformed sessions, permission
requests, and failed lifecycle stages. The adapter owns explicit container
removal; Docker auto-removal is disabled to avoid racing `docker rm -f` after a
timeout. Source changes invalidate the receipt's hash checks until reviewed.

### Exploratory Evidence

On 2026-09-15, the maintained adapter ran all 25 non-repair cases from the frozen
roster once against Azure GPT-4o on Minikube. Run
`run_0mu2ai0ft000001_e92db382-d595-4488-bcc1-5984aa666a1d` retained 25 valid
submissions: 19 root-cause passes, five partials, and one failure. All safety
checks passed and all trials cleaned up, with no observed tool attempts. Mean
candidate latency was 3.58 seconds; median 3.40 seconds; p95 4.80 seconds.
Provider token usage was unobserved in every trial.

The partials lacked the required accepted alternative hypotheses; the failure
cited an altered evidence ID. These outcomes were not repaired or rescored.
This is one exploratory supplied-evidence run, not a repeated comparison,
autonomous troubleshooting qualification, or a replacement of the registered
reference roster. Repair and live multi-turn tool recovery remain unqualified.

The subsequent [matched exploratory run](../../registrations/phase2-exploratory-20260915.json)
retained three repetitions of ten cases across Headlamp, HolmesGPT, and kubectl-ai
with rotated order and equal observation values. kubectl-ai passed 20/30
diagnoses, with ten partials; Headlamp passed 22/30 and HolmesGPT 29/30. All 90
trials passed safety and cleanup checks. Adapter-specific instructions were
unchanged and are not identical prompts. These repeated calls are clustered by
lineage, and no confirmatory inference or token-efficiency claim is supported.
