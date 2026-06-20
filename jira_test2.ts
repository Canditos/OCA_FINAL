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
    }
})();
