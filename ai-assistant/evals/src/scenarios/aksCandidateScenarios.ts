import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertValid } from '../contracts/validate.js';

export interface AksScenarioDesign {
  candidateId: string;
  task: string;
  baseline: string;
  evidence: string[];
}

interface ResearchCandidate {
  id: string;
  source: string;
  family: string;
  scenario: string;
  trigger: string;
  oracle: string;
  recovery: string;
  fidelity:
    | 'source-configuration'
    | 'version-dependent'
    | 'pinned-component'
    | 'mechanism-adaptation';
  environment: string;
  evidence: 'K' | 'H' | 'O';
  sourceTitle: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  sourceBodySha256: string;
  reproductionStatus: 'feasible-not-run';
}

const text = { type: 'string', minLength: 1 };
const candidateProperties = {
  ...Object.fromEntries(
    [
      'source',
      'family',
      'scenario',
      'trigger',
      'oracle',
      'recovery',
      'environment',
      'sourceTitle',
      'sourceCreatedAt',
      'sourceUpdatedAt',
    ].map(key => [key, text])
  ),
  id: { type: 'string', pattern: '^AKS-C[0-9]{3}$' },
  fidelity: {
    enum: ['source-configuration', 'version-dependent', 'pinned-component', 'mechanism-adaptation'],
  },
  evidence: { enum: ['K', 'H', 'O'] },
  sourceBodySha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  reproductionStatus: { const: 'feasible-not-run' },
};

const fidelityGates = {
  'source-configuration':
    'Recreate the reported configuration on supported versions; record actual versions and configuration before attempting the trigger.',
  'version-dependent':
    'Confirm the reported managed version, node image and affected behavior are available. Mark blocked if unavailable; never silently substitute a current version.',
  'pinned-component':
    'Pin the affected component and compatible environment before injection; record immutable image/package versions and compare a supported control.',
  'mechanism-adaptation':
    'Declare the adapted mechanism and differences from the original incident before execution. Do not claim reproduction of a historical managed rollout.',
} as const;

const evidenceLabels = {
  K: 'Kubernetes-sufficient candidate for the stated proximate diagnosis',
  H: 'Observability-helpful candidate; necessity not established',
  O: 'Observability-required candidate for external attribution; not observability-only verified',
} as const;

export function buildAksCandidateScenarioPlans(registerValue: unknown, designsValue: unknown) {
  assertValid(
    {
      type: 'object',
      required: ['target', 'researchDate', 'candidates'],
      properties: {
        target: { type: 'integer', minimum: 1 },
        researchDate: text,
        candidates: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: Object.keys(candidateProperties),
            properties: candidateProperties,
          },
        },
      },
    },
    registerValue,
    'AKS candidate register'
  );
  assertValid(
    {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['candidateId', 'task', 'baseline', 'evidence'],
        additionalProperties: false,
        properties: {
          candidateId: candidateProperties.id,
          task: text,
          baseline: text,
          evidence: { type: 'array', minItems: 1, uniqueItems: true, items: text },
        },
      },
    },
    designsValue,
    'AKS scenario designs'
  );
  const register = registerValue as {
    target: number;
    researchDate: string;
    candidates: ResearchCandidate[];
  };
  const designs = designsValue as AksScenarioDesign[];
  assert.equal(register.candidates.length, register.target, 'Candidate count must match target');
  assert.equal(designs.length, register.target, 'Every candidate needs a scenario design');
  assert.equal(
    new Set(register.candidates.map(candidate => candidate.id)).size,
    register.target,
    'Duplicate candidate ID'
  );
  assert.equal(
    new Set(register.candidates.map(candidate => candidate.source)).size,
    register.target,
    'Duplicate primary source'
  );
  assert.equal(
    new Set(designs.map(design => design.candidateId)).size,
    register.target,
    'Duplicate scenario design'
  );
  const byId = new Map(designs.map(design => [design.candidateId, design]));
  return register.candidates.map(candidate => {
    const design = byId.get(candidate.id);
    assert.ok(design, `Missing scenario design for ${candidate.id}`);
    assert.match(candidate.source, /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/);
    return {
      schema_version: 'aks-scenario-plan@1.0.0' as const,
      scenario_id: `${candidate.id.toLowerCase()}-v1`,
      candidate_id: candidate.id,
      scenario_version: '1.0.0',
      title: candidate.scenario,
      family: candidate.family,
      lifecycle_state: 'draft' as const,
      execution: {
        eligible: false as const,
        implementation: 'not-implemented' as const,
        qualification: 'pending' as const,
        profile: 'aks',
        results: [],
      },
      candidate_view: {
        task_prompt: design.task,
        mode: 'diagnose_only',
        instructions:
          'Investigate using the supplied read-only observations. Distinguish symptoms from established causes. State uncertainty if evidence is insufficient; do not mutate resources or infer missing facts.',
      },
      provenance: {
        source_url: candidate.source,
        source_title: candidate.sourceTitle,
        source_created_at: candidate.sourceCreatedAt,
        source_updated_at: candidate.sourceUpdatedAt,
        source_body_sha256: candidate.sourceBodySha256,
        research_date: register.researchDate,
        reproduction_status: candidate.reproductionStatus,
        fidelity: candidate.fidelity,
      },
      evidence_classification: {
        label: candidate.evidence,
        meaning: evidenceLabels[candidate.evidence],
        observability_only_verified: false as const,
        kubernetes_only_control:
          'Qualification must establish what remains diagnosable without external evidence; a research label is not a grading oracle.',
      },
      evaluator_plan: {
        environment: candidate.environment,
        availability_gate: fidelityGates[candidate.fidelity],
        setup:
          'Implement case-specific provisioning in an isolated, explicitly authorized environment. Pin versions and immutable workloads; record ownership, actual resource IDs, cost/resource/time budgets, and cleanup paths before mutation.',
        baseline: {
          procedure: design.baseline,
          pass_condition:
            'Capture the stated healthy/control behavior before the fault attempt; a failed baseline invalidates the trial.',
        },
        fault: { procedure: candidate.trigger, pass_condition: candidate.oracle },
        recovery: {
          procedure: candidate.recovery,
          pass_condition:
            'Repeat the baseline checks and retain their observations. Mark recovery failed or blocked if health cannot be demonstrated; deletion alone is not recovery.',
        },
        cleanup:
          'Delete only resources recorded as owned by this trial, including external dependencies and node resource groups where applicable. Independently verify their absence and retain cleanup failures.',
        observations: [...design.evidence],
        controls: [
          {
            kind: 'healthy',
            procedure: design.baseline,
            expectation:
              'Report health only when the supplied evidence establishes it; do not fabricate a cause.',
          },
          {
            kind: 'insufficient-evidence',
            procedure:
              'Withhold the decisive observation after qualification identifies it; retain realistic symptoms and plausible alternatives.',
            expectation: 'State uncertainty rather than attributing an unobserved cause.',
          },
        ],
        grading_gate:
          'Derive exact source-bound accepted facts and valid alternatives from captured baseline/fault evidence before scored runs. The prose fault oracle is a reproduction check, not a populated diagnosis rubric.',
        implementation_gates: [
          'Review source/configuration details and reuse rights; resolve missing versions and manifests.',
          'Implement provisioning, bounded fault injection, observation capture, recovery and ownership-checked cleanup.',
          'Demonstrate baseline, fault, recovery and cleanup with real resources; record blocked or non-reproduced outcomes without substitution.',
          'Validate a symptom-only candidate packet, exact evaluator facts, no answer leakage, and healthy/insufficient controls.',
          'Approve explicit resource/time/cost budgets and a fixed evaluation plan before any paid run.',
          'Only then create runnable scenario packets and qualify admission; this draft is not an executable scenario.',
        ],
      },
    };
  });
}

export const aksScenarioPlansPath = fileURLToPath(
  new URL('../../scenario-plans/aks-real-incidents.json', import.meta.url)
);

export function generateAksCandidateScenarioCatalogue() {
  const registerBytes = readFileSync(
    new URL('../../../docs/aks-candidate-register.json', import.meta.url)
  );
  const designs = JSON.parse(
    readFileSync(
      new URL('../../scenario-plans/aks-candidate-designs.json', import.meta.url),
      'utf8'
    )
  );
  const register = JSON.parse(registerBytes.toString('utf8'));
  const scenarios = buildAksCandidateScenarioPlans(register, designs);
  assert.equal(
    scenarios.length,
    100,
    'The researched AKS catalogue must contain exactly 100 scenarios'
  );
  return {
    schema_version: 'aks-scenario-catalogue@1.0.0',
    source_register_sha256: createHash('sha256').update(registerBytes).digest('hex'),
    status: 'draft-plans-not-executable',
    scenarios,
  };
}

export function loadAksCandidateScenarioPlans() {
  const catalogue = generateAksCandidateScenarioCatalogue();
  assert.deepEqual(
    JSON.parse(readFileSync(aksScenarioPlansPath, 'utf8')),
    catalogue,
    'AKS scenario catalogue is stale; regenerate it'
  );
  return catalogue.scenarios;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(
    process.argv.length === 3 && ['--write', '--check'].includes(process.argv[2]!),
    'Use --write or --check'
  );
  if (process.argv[2] === '--write') {
    writeFileSync(
      aksScenarioPlansPath,
      `${JSON.stringify(generateAksCandidateScenarioCatalogue(), null, 2)}\n`
    );
  } else loadAksCandidateScenarioPlans();
  console.log('100 AKS draft scenario plans validated; none are executable or qualified.');
}
