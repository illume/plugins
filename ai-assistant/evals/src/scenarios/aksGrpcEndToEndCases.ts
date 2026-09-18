import assert from 'node:assert/strict';
import { gatewayEnvironment, validateGateway } from './aksGatewayEndToEndCases.js';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

const serverProgram = `import grpc,time,concurrent.futures
def stream(request,context):
    for counter in range(10):
        yield ('tick:'+str(counter)).encode()
        time.sleep(10)
def duplex(requests,context):
    for request in requests:
        yield b'echo:'+request
server=grpc.server(concurrent.futures.ThreadPoolExecutor(max_workers=4))
server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler('research.Echo',{'Stream':grpc.unary_stream_rpc_method_handler(stream),'Duplex':grpc.stream_stream_rpc_method_handler(duplex)}),))
server.add_insecure_port('[::]:50051');server.start();server.wait_for_termination()
`;
const clientProgram = `import grpc,json,sys,time,threading
mode,address=sys.argv[1:3];started=time.monotonic();half_close=threading.Event();first=None;messages=[];code='OK';details=''
def requests():
    yield b'hello'
    half_close.wait(12)
def close(): half_close.set()
timer=threading.Timer(12,close);timer.start()
try:
    with grpc.insecure_channel(address) as channel:
        response=channel.unary_stream('/research.Echo/Stream')(b'begin',timeout=115) if mode=='stream' else channel.stream_stream('/research.Echo/Duplex')(requests(),timeout=30)
        for message in response:
            if first is None:first=time.monotonic()-started
            messages.append(message.decode())
except grpc.RpcError as error:
    code=error.code().name;details=error.details()
finally:timer.cancel();half_close.set()
print(json.dumps({'code':code,'details':details,'first_seconds':first,'elapsed_seconds':time.monotonic()-started,'messages':messages,'half_close_seconds':12}))
`;

function streamingCase(duplex: boolean): AksEndToEndCase {
  return {
    customNetwork: true, enableOidc: true,
    validate(parameters) { validateGateway(parameters); requiredParameter(parameters, 'grpcPythonImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
    async run(context) {
      const gateway = await gatewayEnvironment(context, 'recoveryGateway');
      context.create('grpc-program', { apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata(context, 'grpc-program'), data: { 'server.py': serverProgram, 'client.py': clientProgram } });
      const pod: any = probePod(context, 'grpc-backend'); pod.metadata.labels.app = 'grpc-backend';
      pod.spec.containers[0].image = context.parameters.grpcPythonImage;
      pod.spec.containers[0].command = ['python', '/program/server.py']; pod.spec.containers[0].readinessProbe = { tcpSocket: { port: 50051 } };
      pod.spec.volumes = [{ name: 'program', configMap: { name: 'grpc-program' } }]; pod.spec.containers[0].volumeMounts = [{ name: 'program', mountPath: '/program', readOnly: true }];
      context.create('grpc-backend', pod); await readyPod(context, 'grpc-backend');
      const client: any = structuredClone(pod); client.metadata = metadata(context, 'grpc-client'); client.spec.containers[0].command = ['python', '-c', 'import time; time.sleep(3600)']; delete client.spec.containers[0].readinessProbe;
      context.create('grpc-client', client); await readyPod(context, 'grpc-client');
      context.create('grpc-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'grpc-backend'), spec: { selector: { app: 'grpc-backend' }, ports: [{ name: 'grpc', port: 50051, targetPort: 50051, appProtocol: 'kubernetes.io/h2c' }] } });
      context.create('grpc-route', { apiVersion: 'gateway.networking.k8s.io/v1', kind: 'GRPCRoute', metadata: metadata(context, 'grpc'), spec: {
        parentRefs: [{ name: 'gateway' }], rules: [{ matches: [{ method: { service: 'research.Echo' } }], backendRefs: [{ name: 'grpc-backend', port: 50051 }] }] } });
      const probe = async (address: string) => {
        const name = `grpc-result-${Date.now()}`;
        const result = context.kube(namespaced(context, ['exec', 'grpc-client', '--', 'sh', '-c',
          `python /program/client.py ${duplex ? 'duplex' : 'stream'} ${address} > /tmp/${name}.json 2>/tmp/${name}.err &`]));
        assert.equal(result.status, 0);
        let data: any;
        await context.poll(() => {
          const read = context.kube(namespaced(context, ['exec', 'grpc-client', '--', 'cat', `/tmp/${name}.json`]));
          try { data = JSON.parse(read.stdout); return typeof data.code === 'string'; } catch { return false; }
        }, 'Bounded real gRPC probe completion');
        return data;
      };
      const successful = (result: any) => {
        assert.equal(result.code, 'OK');
        if (duplex) { assert.ok(result.first_seconds !== null && result.first_seconds < 5); assert.ok(result.messages.includes('echo:hello')); }
        else { assert.ok(result.messages.length === 10 && result.elapsed_seconds >= 90); }
      };
      await context.phase('baseline', async () => {
        const direct = await probe('grpc-backend:50051'); successful(direct);
        const routed = await probe(`${gateway.address}:80`); successful(routed); return { direct, routed };
      });
      await context.phase('fault', async () => {
        await gateway.install('affectedGateway'); const routed = await probe(`${gateway.address}:80`);
        const direct = await probe('grpc-backend:50051'); successful(direct);
        if (duplex) { assert.equal(routed.code, 'OK'); assert.ok(routed.first_seconds >= 11 && routed.messages.includes('echo:hello')); }
        else { assert.notEqual(routed.code, 'OK'); assert.ok(routed.elapsed_seconds >= 45 && routed.elapsed_seconds < 90); assert.match(routed.details, /NO_ERROR|RST_STREAM|reset/i); }
        return { direct, routed, route: context.read('grpcroute', 'grpc') };
      });
      await context.phase('recovery', async () => { await gateway.install('recoveryGateway'); const result = await probe(`${gateway.address}:80`); successful(result); return result; });
    },
  };
}

export const aksGrpcEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c053-v1': streamingCase(false),
  'aks-c070-v1': streamingCase(true),
};