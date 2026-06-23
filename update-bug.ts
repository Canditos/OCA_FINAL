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

Steps to Reproduce (from OCTT logs in TC_086_CS):
1. CSMS sends ChangeAvailability (connectorId: 2, type: Operative)
2. SUT responds with Accepted
3. CSMS waits for StatusNotificationRequest
4. SUT goes completely idle regarding status updates and only sends Heartbeat requests every 60 seconds until the test timeouts.

Expected Behavior:
As per OCPP 1.6 Specification, the Charge Point MUST send a StatusNotificationRequest whenever its status changes as a result of an accepted ChangeAvailability request.

---
*Additional Evidence (from built-in restore script):*
This issue is also systematically observed in the built-in OCTT restore script (\`tc_bi_restore_availability\`). 
When that script sends the \`ChangeAvailability\` (Operative), the SUT accepts it but goes silent. The script logs:
\`Did not receive expected StatusNotification within timeout. Will continue with restore\`
This confirms that the SUT consistently accepts availability changes but fails to emit the corresponding \`StatusNotification\`, thus violating the OCPP specification.`;

    const bugKey = "XPECD-5280";

    try {
        await client.updateIssue(bugKey, {
            description: descriptionText
        });
        console.log(`Successfully updated description for ${bugKey}`);
    } catch (err: any) {
        console.error("Error updating issue:");
        if (err.response) {
            console.error(JSON.stringify(err.response.data, null, 2));
        } else {
            console.error(err.message);
        }
    }
}

main().catch(console.error);
