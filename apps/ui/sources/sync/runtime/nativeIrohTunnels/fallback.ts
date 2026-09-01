/**
 * UI projection of the package-owned Home carrier failure contract. Keeping
 * this module path lets the lifecycle owner expose one cohesive barrel without
 * retaining a second fallback decision table.
 */
export {
    classifyIrohHomeCarrierFailure as classifyIrohHomeTunnelSwitchFailure,
    IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR,
    IROH_HOME_TUNNEL_PROBE_FAILED_ERROR,
    IROH_HOME_TUNNEL_STALE_FOCUS_ERROR,
    IROH_HOME_TUNNEL_STALE_GENERATION_ERROR,
    IROH_HOME_TUNNEL_SUSPENDED_ERROR,
    type IrohHomeCarrierFailureClass as IrohHomeTunnelFailureClass,
    type IrohHomeCarrierFailureClassification as IrohHomeTunnelSwitchFailureClassification,
} from '@happier-dev/iroh-native';
