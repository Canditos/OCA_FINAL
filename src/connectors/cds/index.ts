// ══════════════════════════════════════════════════════════════
// CDS Connector Public API
// ══════════════════════════════════════════════════════════════
//
// Re-exports the CDS client and all type definitions so consumers
// can import everything from a single entry point.
//
// Example:
//   import { CdsClient, Specification, ChargeMode, PidList } from "./connectors/cds/index.js";
// ══════════════════════════════════════════════════════════════

export { CdsClient } from "./cds-client.js";
export * from "./types.js";
