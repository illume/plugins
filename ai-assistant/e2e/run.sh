#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER_NAME="${E2E_CLUSTER_NAME:-ai-assistant-e2e}"
KWOK_VERSION="${KWOK_VERSION:-v0.8.0}"
HEADLAMP_URL="${HEADLAMP_URL:-http://127.0.0.1:4466}"
PORT_FORWARD_PID=""

cleanup() {
  if [[ -n "${PORT_FORWARD_PID}" ]]; then
    kill "${PORT_FORWARD_PID}" 2>/dev/null || true
  fi
  if [[ "${KEEP_E2E_CLUSTER:-false}" != "true" ]]; then
    kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for command in docker kind kubectl npm; do
  command -v "${command}" >/dev/null || {
    echo "Missing required command: ${command}" >&2
    exit 1
  }
done

cd "${ROOT_DIR}"
npm run build
npx playwright install chromium

kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
kind create cluster --name "${CLUSTER_NAME}" --config e2e/kind.yaml
CONTROL_PLANE_IP="$(
  kubectl get node "${CLUSTER_NAME}-control-plane" \
    -o jsonpath='{.status.addresses[?(@.type=="InternalIP")].address}'
)"

docker pull "registry.k8s.io/kwok/kwok:${KWOK_VERSION}"
kind load docker-image --name "${CLUSTER_NAME}" "registry.k8s.io/kwok/kwok:${KWOK_VERSION}"
kubectl apply -f "https://github.com/kubernetes-sigs/kwok/releases/download/${KWOK_VERSION}/kwok.yaml"
kubectl apply -f "https://github.com/kubernetes-sigs/kwok/releases/download/${KWOK_VERSION}/stage-fast.yaml"
kubectl -n kube-system patch deployment kwok-controller --type=strategic -p '{
  "spec": {
    "template": {
      "spec": {
        "hostNetwork": true,
        "dnsPolicy": "ClusterFirstWithHostNet",
        "nodeSelector": {"e2e.headlamp.dev/real-node": "true"},
        "containers": [{
          "name": "kwok-controller",
          "env": [
            {"name": "KUBERNETES_SERVICE_HOST", "value": "'"${CONTROL_PLANE_IP}"'"},
            {"name": "KUBERNETES_SERVICE_PORT", "value": "6443"}
          ]
        }],
        "tolerations": [{
          "key": "node-role.kubernetes.io/control-plane",
          "operator": "Exists",
          "effect": "NoSchedule"
        }]
      }
    }
  }
}'
kubectl -n kube-system rollout status deployment/kwok-controller --timeout=180s
kubectl apply -f e2e/kwok-fixtures.yaml
kubectl wait node/kwok-worker --for=condition=Ready --timeout=120s

docker build -f e2e/Dockerfile.headlamp -t headlamp-ai-e2e:local .
kind load docker-image --name "${CLUSTER_NAME}" headlamp-ai-e2e:local
kubectl apply -f e2e/headlamp.yaml
kubectl -n headlamp set env deployment/headlamp \
  KUBERNETES_SERVICE_HOST="${CONTROL_PLANE_IP}" \
  KUBERNETES_SERVICE_PORT=6443
kubectl -n headlamp scale deployment/headlamp --replicas=1
kubectl -n headlamp rollout status deployment/headlamp --timeout=180s

kubectl -n headlamp port-forward service/headlamp 4466:80 >"${TMPDIR:-/tmp}/headlamp-e2e-port-forward.log" 2>&1 &
PORT_FORWARD_PID=$!
for _ in {1..30}; do
  if curl --fail --silent "${HEADLAMP_URL}" >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent "${HEADLAMP_URL}" >/dev/null

HEADLAMP_URL="${HEADLAMP_URL}" npm run e2e:playwright
