import fs from "fs";
import axios from "axios";
import { JiraClient } from "./src/connectors/jira/index.js";
import { loadConfig } from "./src/apps/certification-dashboard/config/dashboard.config.js";

const chademoKeys = [
    "XPECD-9", "XPECD-70", "XPECD-10",
    "XPECD-1993", 
    "XPECD-2585", "XPECD-2907",
    "XPECD-73", "XPECD-74", "XPECD-75",
    "XPECD-72"
];

async function main() {
    const config = loadConfig();
    const client = new JiraClient({
        baseUrl: config.jiraBaseUrl,
        email: config.jiraEmail,
        apiToken: config.jiraApiToken,
        projectKey: config.jiraProjectKey
    });

    const xrayToken = await client.authenticateXray(config.xrayClientId, config.xrayClientSecret);

    const testIssueIds: string[] = [];

    console.log(`Resolving internal IDs for CHAdeMO tests...`);
    for (const key of chademoKeys) {
        try {
            const issue = await client.getIssue(key);
            if (issue) {
                testIssueIds.push(issue.id);
                console.log(`Found ${key} -> ID: ${issue.id}`);
            }
        } catch (e: any) {
            console.error(`Failed to get issue ${key}: ${e.message}`);
        }
    }

    const testPlanId = "341554"; // ID for XPECD-5282

    if (testIssueIds.length > 0) {
        console.log(`\nRemoving ${testIssueIds.length} CHAdeMO tests from Test Plan XPECD-5282...`);
        const query = `
          mutation RemoveTests($issueId: String!, $testIssueIds: [String]!) {
            removeTestsFromTestPlan(
              issueId: $issueId,
              testIssueIds: $testIssueIds
            )
          }
        `;
        try {
            const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
                query,
                variables: { issueId: testPlanId, testIssueIds: testIssueIds }
            }, {
                headers: {
                    Authorization: `Bearer ${xrayToken}`,
                    "Content-Type": "application/json"
                }
            });

            if (response.data?.errors) {
                console.error("❌ GraphQL Errors:", JSON.stringify(response.data.errors, null, 2));
            } else {
                console.log("✅ Tests removed successfully from Test Plan!");
            }
        } catch (e: any) {
            if (e.response) {
                console.error("❌ Axios Error:", JSON.stringify(e.response.data, null, 2));
            } else {
                console.error(e.message);
            }
        }
    }
}

main().catch(console.error);
