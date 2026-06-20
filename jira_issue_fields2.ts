import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);
        
        for (const key of ['XPECD-5265', 'XPECD-5260', 'XPECD-5250', 'XPECD-5263']) {
            try {
                const issue = await client.getIssue(key);
                console.log(`${key}: SUT=`, issue.fields['customfield_11499'], 'FW=', issue.fields['customfield_11488']);
            } catch (e) {
                console.log(`${key}: not found`);
            }
        }
    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
