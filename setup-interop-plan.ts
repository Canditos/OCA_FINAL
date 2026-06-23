import fs from "fs";
import axios from "axios";
import { JiraClient } from "./src/connectors/jira/index.js";
import { loadConfig } from "./src/apps/certification-dashboard/config/dashboard.config.js";

const testKeys = [
    "XPECD-11", "XPECD-76", "XPECD-12",
    "XPECD-13", "XPECD-2318", "XPECD-2319", "XPECD-2320", "XPECD-37", "XPECD-14", "XPECD-38",
    "XPECD-9", "XPECD-70", "XPECD-10",
    "XPECD-1992", "XPECD-1993", "XPECD-1994", "XPECD-1996",
    "XPECD-661", "XPECD-2585", "XPECD-2907",
    "XPECD-43", "XPECD-44", "XPECD-45", "XPECD-2306", "XPECD-2309", "XPECD-2314", "XPECD-2307", "XPECD-2310", "XPECD-2313", "XPECD-2308", "XPECD-2311", "XPECD-2312",
    "XPECD-73", "XPECD-74", "XPECD-75",
    "XPECD-77", "XPECD-42", "XPECD-2390", "XPECD-2391", "XPECD-2392", "XPECD-72",
    "XPECD-40", "XPECD-180", "XPECD-41", "XPECD-527",
    "XPECD-422", "XPECD-2163", "XPECD-4140", "XPECD-4942", "XPECD-4733",
    "XPECD-2425", "XPECD-2428", "XPECD-2437", "XPECD-2446", "XPECD-2447",
    "XPECD-3682", "XPECD-3802", "XPECD-3806",
    "XPECD-2051", "XPECD-2134", "XPECD-2133",
    "XPECD-2103", "XPECD-2105", "XPECD-2104",
    "XPECD-2135", "XPECD-2137", "XPECD-2136",
    "XPECD-2106", "XPECD-2108", "XPECD-2107",
    "XPECD-2110", "XPECD-2112", "XPECD-2111",
    "XPECD-2113", "XPECD-2115", "XPECD-2114",
    "XPECD-3227", "XPECD-3228",
    "XPECD-2124", "XPECD-2125", "XPECD-2166", "XPECD-2168", "XPECD-2169",
    "XPECD-1954", "XPECD-1961", "XPECD-1958", "XPECD-1960", "XPECD-2845", "XPECD-2844", "XPECD-2846", "XPECD-2847", "XPECD-635", "XPECD-2861",
    "XPECD-3032", "XPECD-3144", "XPECD-3145", "XPECD-2116", "XPECD-2117", "XPECD-3917", "XPECD-3918", "XPECD-4729",
    "XPECD-4251", "XPECD-4389",
    "XPECD-4617", "XPECD-4618", "XPECD-4620", "XPECD-4619", "XPECD-4934",
    "XPECD-16", "XPECD-17", "XPECD-2159", "XPECD-2162", "XPECD-2944",
    "XPFGST-555", "XPFGST-556", "XPFGST-557",
    "XPFGST-598", "XPFGST-599", "XPFGST-601",
    "XPFGST-620", "XPFGST-621", "XPFGST-622",
    "XPFGST-4226", "XPFGST-4227", "XPFGST-4230",
    "XPECD-2013", "XPECD-378", "XPECD-2349",
    "XPECD-4959", "XPECD-4960", "XPECD-4961"
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

    console.log(`Starting to process ${testKeys.length} tests...`);
    for (let i = 0; i < testKeys.length; i++) {
        const key = testKeys[i];
        try {
            const issue = await client.getIssue(key);
            if (!issue) {
                console.log(`[${i+1}/${testKeys.length}] ❌ ${key} not found.`);
                continue;
            }
            
            testIssueIds.push(issue.id);
            
            let currentLabels = issue.fields?.labels || [];
            if (!currentLabels.includes("Interop")) {
                currentLabels.push("Interop");
                await client.updateIssue(key, { labels: currentLabels });
                console.log(`[${i+1}/${testKeys.length}] ✅ Added 'Interop' label to ${key}`);
            } else {
                console.log(`[${i+1}/${testKeys.length}] ⏭️ ${key} already has 'Interop' label.`);
            }
        } catch (err: any) {
            console.error(`[${i+1}/${testKeys.length}] ❌ Failed to process ${key}: ${err.message}`);
        }
    }

    console.log(`\nAll tests processed. Valid test IDs found: ${testIssueIds.length}`);

    // Create Test Plan
    console.log(`\nCreating Test Plan 'Interoperability P-Index Test Plan'...`);
    let testPlanId = "";
    let testPlanKey = "";
    try {
        const issue = await client.createIssue({
            summary: "Interoperability P-Index Test Plan",
            description: "A dedicated Test Plan grouping all EV and Backend interoperability test scenarios.",
            issueType: "Test Plan",
            labels: ["Interop"]
        });
        testPlanKey = issue.key;
        testPlanId = issue.id;
        console.log(`✅ Test Plan created successfully: ${testPlanKey} (ID: ${testPlanId})`);
    } catch (err: any) {
        console.error("❌ Failed to create Test Plan:");
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
        return;
    }

    if (testIssueIds.length > 0 && testPlanId) {
        console.log(`\nLinking ${testIssueIds.length} tests to Test Plan ${testPlanKey}...`);
        const query = `
          mutation AddTests($issueId: String!, $testIssueIds: [String]!) {
            addTestsToTestPlan(
              issueId: $issueId,
              testIssueIds: $testIssueIds
            ) {
              addedTests
              warning
            }
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
                console.log("✅ Tests linked successfully to Test Plan!");
                console.log(response.data?.data?.addTestsToTestPlan);
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
