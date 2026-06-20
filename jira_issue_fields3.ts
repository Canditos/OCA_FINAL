import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);
        
        const issue = await client.getIssue('XPECD-5257');
        console.log(`XPECD-5257: SUT=`, issue.fields['customfield_11499'], 'FW=', issue.fields['customfield_11488'], 'OCPP=', issue.fields['customfield_11498']);
    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
