import fs from "fs";
import axios from "axios";
import { JiraClient } from "./src/connectors/jira/index.js";
import { loadConfig } from "./src/apps/certification-dashboard/config/dashboard.config.js";

const PICS_TESTS = [
    "TC_001_CS", "TC_002_CS", "TC_003_CS", "TC_004_1_CS", "TC_004_2_CS",
    "TC_005_2_CS", "TC_007_1_CS", "TC_008_1_CS", "TC_010_CS", "TC_011_1_CS",
    "TC_011_2_CS", "TC_012_CS", "TC_013_CS", "TC_014_CS", "TC_015_CS",
    "TC_016_CS", "TC_017_2_CS", "TC_018_2_CS", "TC_019_CS", "TC_021_CS",
    "TC_023_4_CS", "TC_026_CS", "TC_028_CS", "TC_031_CS", "TC_032_2_CS",
    "TC_034_CS", "TC_036_CS", "TC_037_1_CS", "TC_037_2_CS", "TC_037_3_CS",
    "TC_038_CS", "TC_039_CS", "TC_040_1_CS", "TC_040_2_CS", "TC_042_2_CS",
    "TC_043_CS", "TC_043_2_CS", "TC_045_1_CS", "TC_045_2_CS", "TC_046_1_CS",
    "TC_046_2_CS", "TC_047_CS", "TC_048_2_CS", "TC_048_3_CS", "TC_049_CS",
    "TC_050_2_CS", "TC_050_3_CS", "TC_051_CS", "TC_052_CS", "TC_053_1_CS",
    "TC_054_CS", "TC_055_CS", "TC_056_CS", "TC_057_CS", "TC_058_1_CS",
    "TC_058_2_CS", "TC_059_CS", "TC_060_CS", "TC_061_1_CS", "TC_062_CS",
    "TC_066_CS", "TC_067_CS", "TC_068_CS", "TC_069_CS", "TC_070_CS",
    "TC_071_CS", "TC_072_CS", "TC_073_CS", "TC_075_1_CS", "TC_075_2_CS",
    "TC_076_CS", "TC_078_CS", "TC_079_CS", "TC_080_CS", "TC_081_CS",
    "TC_082_CS", "TC_083_CS", "TC_084_CS", "TC_085_CS", "TC_086_CS"
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
    
    const execKey = "XPECD-5264";
    const execIssue = await client.getIssue(execKey);
    const execId = execIssue.id;

    const getTestsQuery = `
      query GetExec($issueId: String!) {
        getTestExecution(issueId: $issueId) {
          testRuns(limit: 100) {
            results {
              test {
                issueId
                jira(fields: ["key", "summary"])
              }
            }
          }
        }
      }
    `;
    const getResp = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
        query: getTestsQuery,
        variables: { issueId: execId }
    }, {
        headers: {
            Authorization: `Bearer ${xrayToken}`,
            "Content-Type": "application/json"
        }
    });

    const testRuns = getResp.data?.data?.getTestExecution?.testRuns?.results || [];
    const tests = testRuns.map((r: any) => ({
        id: r.test.issueId,
        key: r.test.jira.key,
        testCaseName: r.test.jira.summary
    }));

    console.log(`Current tests in execution: ${tests.length}`);

    const testsToRemoveIds: string[] = [];
    const testsToRemoveKeys: string[] = [];

    for (const t of tests) {
        // Extract TC_XXX from testCaseName
        const match = t.testCaseName?.match(/(TC_\d+(_\d+)?_CS)/);
        const testIdentifier = match ? match[1] : t.testCaseName;
        
        let isPics = false;
        if (testIdentifier) {
            isPics = PICS_TESTS.includes(testIdentifier);
        }

        if (!isPics) {
            console.log(`- NOT PICS: ${t.key} (${t.testCaseName})`);
            testsToRemoveIds.push(t.id);
            testsToRemoveKeys.push(t.key);
        }
    }

    console.log(`Found ${testsToRemoveIds.length} non-PICS tests still in execution.`);

    if (testsToRemoveIds.length > 0) {
        console.log("Removing them now...");
        const query = `
          mutation RemoveTests($issueId: String!, $testIssueIds: [String]!) {
            removeTestsFromTestExecution(
              issueId: $issueId,
              testIssueIds: $testIssueIds
            )
          }
        `;
        const response = await axios.post("https://xray.cloud.getxray.app/api/v2/graphql", {
            query,
            variables: { issueId: execId, testIssueIds: testsToRemoveIds }
        }, {
            headers: {
                Authorization: `Bearer ${xrayToken}`,
                "Content-Type": "application/json"
            }
        });
        console.log("Removal response:", response.data);
    }
}

main().catch(console.error);
