import { OcttClient } from "../connectors/octt/index.js";
import { JiraClient } from "../connectors/jira/index.js";
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";

config();

async function syncReport(testcaseName: string, jiraIssueKey: string) {
    const octt = new OcttClient({
        baseUrl: process.env.OCTT_BASE_URL || "",
        token: process.env.OCTT_TOKEN || "",
        ocppVersion: "ocpp1.6",
        role: "CS"
    });

    const jira = new JiraClient({
        baseUrl: process.env.JIRA_BASE_URL || "",
        email: process.env.JIRA_EMAIL || "",
        apiToken: process.env.JIRA_API_TOKEN || "",
        projectKey: process.env.JIRA_PROJECT_KEY || ""
    });

    console.log(`[*] Syncing report for ${testcaseName} to Jira issue ${jiraIssueKey}...`);

    try {
        // 1. Obter o logfile_name do relatório mais recente para este testcase
        const reports = await octt.getReports({ testcase_name: testcaseName });
        if (!reports.data || reports.data.length === 0) {
            console.error(`[!] No reports found in OCTT for ${testcaseName}`);
            return;
        }

        const latestReport = reports.data[0];
        const logfileName = latestReport.logfile;
        const configName = latestReport.configuration;

        console.log(`[*] Downloading PDF report for ${logfileName}...`);

        // 2. Descarregar o PDF
        const pdfContent = await octt.downloadReports({
            format: "pdf",
            configuration_name: configName,
            logfile_name: logfileName
        });

        // 3. Upload para o Jira
        const filename = `${testcaseName}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
        await jira.addAttachment(jiraIssueKey, filename, pdfContent);

        console.log(`[+] Successfully attached ${filename} to Jira issue ${jiraIssueKey}!`);
    } catch (error) {
        console.error(`[!] Failed to sync report:`, error);
    }
}

// Exemplo de uso:
// syncReport("TC_019_CS", "OCTT-123");
