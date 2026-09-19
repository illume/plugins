import { aksAdditionalEndToEndCases } from './aksEndToEndCases.js';
import { aksDiskEndToEndCases } from './aksDiskEndToEndCases.js';
import { aksFileEndToEndCases } from './aksFileEndToEndCases.js';
import { aksIdentityEndToEndCases } from './aksIdentityEndToEndCases.js';
import { aksNetworkEndToEndCases } from './aksNetworkEndToEndCases.js';
import { aksWindowsEndToEndCases } from './aksWindowsEndToEndCases.js';
import { aksScalingEndToEndCases } from './aksScalingEndToEndCases.js';
import { aksAddonEndToEndCases } from './aksAddonEndToEndCases.js';
import { aksSnapshotEndToEndCases } from './aksSnapshotEndToEndCases.js';
import { aksTelemetryEndToEndCases } from './aksTelemetryEndToEndCases.js';
import { aksPrivateEndToEndCases } from './aksPrivateEndToEndCases.js';
import { aksFilePlatformEndToEndCases } from './aksFilePlatformEndToEndCases.js';
import { aksChartEndToEndCases } from './aksChartEndToEndCases.js';
import { aksDataplaneEndToEndCases } from './aksDataplaneEndToEndCases.js';
import { aksAdvancedScalingEndToEndCases } from './aksAdvancedScalingEndToEndCases.js';
import { aksGatewayEndToEndCases } from './aksGatewayEndToEndCases.js';
import { aksDiskCapacityEndToEndCases } from './aksDiskCapacityEndToEndCases.js';
import { aksExtensionEndToEndCases } from './aksExtensionEndToEndCases.js';
import { aksPrivateFileEndToEndCases } from './aksPrivateFileEndToEndCases.js';
import { aksAuthorizationEndToEndCases } from './aksAuthorizationEndToEndCases.js';
import { aksProvisioningEndToEndCases } from './aksProvisioningEndToEndCases.js';
import { aksGrpcEndToEndCases } from './aksGrpcEndToEndCases.js';
import { aksFileFailureEndToEndCases } from './aksFileFailureEndToEndCases.js';
import { aksCrossSubscriptionEndToEndCases } from './aksCrossSubscriptionEndToEndCases.js';
import { aksSnapshotDeleteEndToEndCases } from './aksSnapshotDeleteEndToEndCases.js';
import { aksNodeDnsEndToEndCases } from './aksNodeDnsEndToEndCases.js';
import { aksManagedStartupEndToEndCases } from './aksManagedStartupEndToEndCases.js';
import { aksManagedTelemetryEndToEndCases } from './aksManagedTelemetryEndToEndCases.js';
import { aksIdentityBindingEndToEndCases } from './aksIdentityBindingEndToEndCases.js';
import { aksIngressControllerEndToEndCases } from './aksIngressControllerEndToEndCases.js';
import { aksNetworkConfigurationEndToEndCases } from './aksNetworkConfigurationEndToEndCases.js';
import { aksRoutingDetailEndToEndCases } from './aksRoutingDetailEndToEndCases.js';
import { aksPolicyInteractionEndToEndCases } from './aksPolicyInteractionEndToEndCases.js';
import { aksProxyBootstrapEndToEndCases } from './aksProxyBootstrapEndToEndCases.js';
import { aksWindowsSqlEndToEndCases } from './aksWindowsSqlEndToEndCases.js';
import { aksCrossTenantEndToEndCases } from './aksCrossTenantEndToEndCases.js';
import { aksExpansionEndToEndCases } from './aksExpansionEndToEndCases.js';
import { aksEnergyEndToEndCases } from './aksEnergyEndToEndCases.js';
import { aksArchitectureEndToEndCases } from './aksArchitectureEndToEndCases.js';
import type { AksEndToEndCase } from './aksEndToEndCases.js';

export const aksEndToEndCases: Record<string, AksEndToEndCase> = {
  ...aksAdditionalEndToEndCases,
  ...aksDiskEndToEndCases,
  ...aksFileEndToEndCases,
  ...aksIdentityEndToEndCases,
  ...aksNetworkEndToEndCases,
  ...aksWindowsEndToEndCases,
  ...aksScalingEndToEndCases,
  ...aksAddonEndToEndCases,
  ...aksSnapshotEndToEndCases,
  ...aksTelemetryEndToEndCases,
  ...aksPrivateEndToEndCases,
  ...aksFilePlatformEndToEndCases,
  ...aksChartEndToEndCases,
  ...aksDataplaneEndToEndCases,
  ...aksAdvancedScalingEndToEndCases,
  ...aksGatewayEndToEndCases,
  ...aksDiskCapacityEndToEndCases,
  ...aksExtensionEndToEndCases,
  ...aksPrivateFileEndToEndCases,
  ...aksAuthorizationEndToEndCases,
  ...aksProvisioningEndToEndCases,
  ...aksGrpcEndToEndCases,
  ...aksFileFailureEndToEndCases,
  ...aksCrossSubscriptionEndToEndCases,
  ...aksSnapshotDeleteEndToEndCases,
  ...aksNodeDnsEndToEndCases,
  ...aksManagedStartupEndToEndCases,
  ...aksManagedTelemetryEndToEndCases,
  ...aksIdentityBindingEndToEndCases,
  ...aksIngressControllerEndToEndCases,
  ...aksNetworkConfigurationEndToEndCases,
  ...aksRoutingDetailEndToEndCases,
  ...aksPolicyInteractionEndToEndCases,
  ...aksProxyBootstrapEndToEndCases,
  ...aksWindowsSqlEndToEndCases,
  ...aksCrossTenantEndToEndCases,
  ...aksExpansionEndToEndCases,
  ...aksEnergyEndToEndCases,
  ...aksArchitectureEndToEndCases,
};

export function hasAksEndToEndImplementation(id: string) {
  return id === 'aks-c089-v1' || Object.hasOwn(aksEndToEndCases, id);
}