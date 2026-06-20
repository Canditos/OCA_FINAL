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
            __type(name: "Test") {
              fields {
                name
                type {
                  name
                  kind
                  ofType {
                    name
                    kind
                  }
                }
              }
            }
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", { query }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        const stepsField = response.data.data.__type.fields.find((f: any) => f.name === 'steps');
        console.log("Steps field:", JSON.stringify(stepsField, null, 2));
    } catch (err: any) {
        console.error("Error:", err.message);
    }
})();
