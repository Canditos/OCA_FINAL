import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);
        
        const issue = await client.getIssue('XPECD-5264');
        console.log("XPECD-5264 Fields:", Object.keys(issue.fields).filter(k => issue.fields[k] !== null).map(k => `${k}: ${JSON.stringify(issue.fields[k])}`));
    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
