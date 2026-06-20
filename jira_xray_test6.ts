import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';
import axios from 'axios';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);
        const token = await client.authenticateXray(config.xray.clientId, config.xray.clientSecret);

        const issue = await client.getIssue('XPECD-5264');
        
        const query = `
          query GetTestExecution($issueId: String!) {
            getTestExecution(issueId: $issueId) {
              testRuns(limit: 1) {
                results {
                  customFields {
                    id
                    value
                  }
                }
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { issueId: issue.id }
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log(JSON.stringify(response.data, null, 2));
    } catch (err: any) {
        console.error("Error:", err.message);
        if (err.response) console.error(JSON.stringify(err.response.data, null, 2));
    }
})();
