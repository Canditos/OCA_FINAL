import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);

        console.log('Fetching Xray Test Run Custom Fields for project:', config.jira.projectKey);
        
        const xrayFields = await client.getXrayCustomFieldsSpec(
            config.xray.clientId,
            config.xray.clientSecret,
            config.jira.projectKey
        );
        
        console.log(JSON.stringify(xrayFields, null, 2));

    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
