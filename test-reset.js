const cdsId = 'cds-192-168-100-80-51001';
const baseUrl = `http://localhost:3101/api/i/${cdsId}`;

async function run() {
    console.log("Triggering reset...");
    const resetResp = await fetch(`${baseUrl}/reset`, { method: 'POST' });
    console.log('Reset response:', await resetResp.json());
    
    const val = await fetch(`${baseUrl}/validate`, { method: 'POST' });
    const json = await val.json();
    console.log(`Status after reset: ${json.statusDesc.join(', ')} | Errors: ${json.errorsDesc}`);
}
run().catch(console.error);
