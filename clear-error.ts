import { CdsClient } from "./src/connectors/cds/cds-client.js";
import { PidList, CdsControl } from "./src/connectors/cds/types.js";

async function run() {
    const cds = new CdsClient("192.168.100.80", 51001);
    await cds.connect();
    
    console.log("Sending CdsControl.Reset (16) to Control PID...");
    await cds.writeSinglePid(PidList.Control, "int32", CdsControl.Reset);
    
    // wait a bit
    await new Promise(r => setTimeout(r, 2000));
    
    const measurements = await cds.readMeasurements();
    const status = cds.statusValue.getValue();
    const flags = cds.getStatusDescription(status);
    console.log("Status after reset:", status, flags);
    
    await cds.disconnect();
}
run().catch(console.error);
