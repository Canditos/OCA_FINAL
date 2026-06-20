const cdsId = 'cds-192-168-100-80-51001';
const baseUrl = `http://localhost:3101/api/i/${cdsId}`;

async function checkStatus(step) {
    const val = await fetch(`${baseUrl}/validate`, { method: 'POST' });
    const json = await val.json();
    console.log(`[${step}] Status: ${json.statusDesc.join(', ')} | Errors: ${json.errorsDesc}`);
    return json;
}

async function run() {
    await fetch(`${baseUrl}/stop`, { method: 'POST' });
    await fetch(`${baseUrl}/reset`, { method: 'POST' });
    await checkStatus('After Reset');
    
    await fetch(`${baseUrl}/configure-cds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specification: 3, chargeMode: 2, sinkId: 11, mode: 2 })
    });
    await checkStatus('After Configure CDS');

    await fetch(`${baseUrl}/configure-ev`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ EVMaximumVoltageLimit: 500, EVMinimumVoltageLimit: 400, EVMaximumCurrentLimit: 50, EVMinimumCurrentLimit: 0, EVMaximumPowerLimit: 10000, BatteryCapacity: 50000, EVstateOfCharge: 50 })
    });
    await checkStatus('After Configure EV');

    await fetch(`${baseUrl}/start`, { method: 'POST' });
    await checkStatus('After Start');
}

run().catch(console.error);
