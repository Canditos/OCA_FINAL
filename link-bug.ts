import fs from "fs";
import path from "path";
import axios from "axios";
import { JiraClient } from "./src/connectors/jira/index.js";
import { OcttClient } from "./src/connectors/octt/index.js";
import { loadConfig } from "./src/apps/certification-dashboard/config/dashboard.config.js";

async function main() {
    const config = loadConfig();
    const client = new JiraClient({
        baseUrl: config.jiraBaseUrl,
        email: config.jiraEmail,
        apiToken: config.jiraApiToken,
        projectKey: config.jiraProjectKey
    });

    const octtUrl = config.octtBaseUrl || "http://localhost:12810";
    const octtToken = config.octtApiToken || "";
    
    const octt = new OcttClient({
        baseUrl: octtUrl,
        token: octtToken,
        ocppVersion: "ocpp1.6",
        role: "CS"
    });

    const testKey = "XPECD-5254"; // TC_086_CS
    const bugKey = "XPECD-5280";

    console.log(`Fetching logs from OCTT for TC_086_CS...`);
    // Use GET /reports to avoid 500
    const reports = await octt.getReports();

    if (reports.data && reports.data.length > 0) {
        // Filter locally
        const targetReportList = reports.data.filter((r: any) => 
            r.testcase_name && r.testcase_name.includes("TC_086") &&
            r.configuration && r.configuration.startsWith("AUT_SID_SAT")
        );

        if (targetReportList.length === 0) {
            console.log("No reports found matching TC_086 and AUT_SID_SAT.");
            return;
        }

        // Find the one that failed or inconc
        const latestReport = targetReportList.find((r: any) => r.verdict === "INCONC" || r.verdict === "FAIL") || targetReportList[0];
        const logfileName = path.basename(latestReport.logfile);
        const configName = latestReport.configuration;

        console.log(`Downloading zip for ${logfileName} / ${configName}...`);
        const zipBuffer = await octt.downloadReports({
            format: "ZIP",
            configuration_name: configName,
            logfile_name: logfileName
        });

        console.log(`Attaching to test ${testKey}...`);
        await client.addAttachment(testKey, `TC_086_CS_evidence.zip`, zipBuffer);
        console.log("Attached successfully!");
    } else {
        console.log("No reports found in OCTT");
    }

    console.log(`Linking Bug ${bugKey} to Test ${testKey}...`);
    const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString("base64");
    const linkUrl = `${config.jiraBaseUrl.replace(/\/+$/, "")}/rest/api/3/issueLink`;

    try {
        await axios.post(linkUrl, {
            type: {
                name: "Relates"
            },
            inwardIssue: {
                key: bugKey
            },
            outwardIssue: {
                key: testKey
            }
        }, {
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json"
            }
        });
        console.log("Linked successfully!");
    } catch (err: any) {
        console.error("Link Error:", err.response?.data || err.message);
    }
}

main().catch(console.error);
