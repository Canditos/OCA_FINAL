import { JiraClient } from './src/connectors/jira/jira-client.ts';
import fs from 'fs';

(async () => {
    try {
        const configRaw = fs.readFileSync('D:/OCA_FINAL_CANDITOS/dashboard-config.json', 'utf8');
        const saved = JSON.parse(configRaw);
        
        const client = new JiraClient({
            baseUrl: saved.jiraBaseUrl,
            email: saved.jiraEmail,
            apiToken: saved.jiraApiToken,
            projectKey: saved.jiraProjectKey
        });

        const fields = await client.getFieldIds(['FW Version', 'DUT', 'OCPP backend']);
        console.log('Found Field IDs:', fields);
        
        for (const [name, id] of Object.entries(fields)) {
            try {
                // @ts-ignore
                const contexts = await client.axios.get('/field/' + id + '/context');
                console.log(`Contexts for ${name}:`, contexts.data.values.map((c: any) => c.id));
                if (contexts.data.values.length > 0) {
                    const contextId = contexts.data.values[0].id;
                    // @ts-ignore
                    const options = await client.axios.get('/field/' + id + '/context/' + contextId + '/option');
                    console.log(`Options for ${name}:`, options.data.values.map((o: any) => o.value));
                }
            } catch (e: any) {
                console.error(`Failed to get context for ${name}: ${e.message}`);
            }
        }
    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
