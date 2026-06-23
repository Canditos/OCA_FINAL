import fs from "fs";
import { JiraClient } from "./src/connectors/jira/index.js";
import { loadConfig } from "./src/apps/certification-dashboard/config/dashboard.config.js";

async function main() {
    const config = loadConfig();
    const client = new JiraClient({
        baseUrl: config.jiraBaseUrl,
        email: config.jiraEmail,
        apiToken: config.jiraApiToken,
        projectKey: config.jiraProjectKey
    });

    const descriptionText = `During the execution of the OCTT tests, the test TC_086_CS failed (Timeout/Inconclusive) during the initial Restore Procedure. 
The OCTT sent a ChangeAvailability request to change Connector 2 to Operative. The SUT successfully replied with an Accepted status. However, the SUT never sent the required StatusNotificationRequest to reflect the new state of the connector, causing the OCTT to hang indefinitely waiting for the message.

Steps to Reproduce (from OCTT logs):
1. CSMS sends ChangeAvailability (connectorId: 2, type: Operative)
2. SUT responds with Accepted
3. CSMS waits for StatusNotificationRequest
4. SUT goes completely idle regarding status updates and only sends Heartbeat requests every 60 seconds until the test timeouts.

Expected Behavior:
As per OCPP 1.6 Specification, the Charge Point MUST send a StatusNotificationRequest whenever its status changes as a result of an accepted ChangeAvailability request.`;

    const summary = "[OCPP 1.6] SUT fails to send StatusNotification after accepting ChangeAvailability (Operative)";

    try {
        const issue = await client.createIssue({
            summary,
            description: descriptionText,
            issueType: "Bug",
            labels: ["Firmware", "OCPP1.6", "Bug"]
        });
        
        console.log("Issue created successfully:", issue.key);
    } catch (err: any) {
        console.error("Error creating issue:");
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
    }
}

main().catch(console.error);
