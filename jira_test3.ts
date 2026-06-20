import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);

        const fields = await client.getCustomFields();
        console.log('Total custom fields:', fields.length);
        
        const targetNames = ['fw', 'dut', 'sut', 'ocpp', 'version', 'system', 'test', 'backend'];
        
        fields.forEach(f => {
            const name = f.name.toLowerCase();
            if (targetNames.some(t => name.includes(t))) {
                console.log(`- [${f.id}] ${f.name}`);
            }
        });
    } catch (err: any) {
        console.error("Error:", err.message);
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", err.response.data);
        }
    }
})();
