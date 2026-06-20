import { JiraClient } from './src/connectors/jira/jira-client.ts';
import { loadConfig, buildEffectiveConfig } from './src/apps/certification-dashboard/config/dashboard.config.ts';
import axios from 'axios';

(async () => {
    try {
        const config = buildEffectiveConfig(loadConfig());
        const client = new JiraClient(config.jira);
        const token = await client.authenticateXray(config.xray.clientId, config.xray.clientSecret);

        const query = `
          query {
            __type(name: "Step") {
              fields {
                name
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", { query }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log("Step fields:", JSON.stringify(response.data.data.__type.fields, null, 2));
    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
