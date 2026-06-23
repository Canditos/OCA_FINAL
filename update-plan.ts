import axios from "axios";
import { loadConfig } from "./src/apps/certification-dashboard/config/dashboard.config.js";

async function main() {
    const config = loadConfig();
    const planKey = "XPECD-5282";

    const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString("base64");
    const updateUrl = `${config.jiraBaseUrl.replace(/\/+$/, "")}/rest/api/3/issue/${planKey}`;

    const adfDescription = {
      "version": 1,
      "type": "doc",
      "content": [
        {
          "type": "heading",
          "attrs": { "level": 1 },
          "content": [ { "type": "text", "text": "Validation Test Set — EV ↔ Charger ↔ Backend Interoperability" } ]
        },
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "Overview", "marks": [{"type": "strong"}] }
          ]
        },
        {
          "type": "paragraph",
          "content": [ { "type": "text", "text": "This test plan groups test cases to validate the interoperability of the EV Charger with both the electric vehicle (EV) and the backend cloud platform, ensuring end-to-end reliability for charging sessions, remote management, and billing." } ]
        },
        {
          "type": "heading",
          "attrs": { "level": 2 },
          "content": [ { "type": "text", "text": "1. Interoperability with Vehicles (EV ↔ Charger)" } ]
        },
        {
          "type": "paragraph",
          "content": [ { "type": "text", "text": "Validates the physical and electrical interactions with vehicles across all applicable connectors (AC and CCS):" } ]
        },
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Charging Flows: ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "Start, stop, cancel, and timeouts." }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Safety & Hardware: ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "HV insulation monitoring, emergency stops, open-door protections, and fast shutdown upon CP loss." }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Dynamic Requests: ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "ERK coordination and varying current requests." }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "heading",
          "attrs": { "level": 2 },
          "content": [ { "type": "text", "text": "2. Interoperability with Backends (Charger ↔ Backend)" } ]
        },
        {
          "type": "paragraph",
          "content": [ { "type": "text", "text": "Validates the OCPP connectivity and financial integrations:" } ]
        },
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "OCPP Core: ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "Connectivity stability, Smart Charging profiles, and PowerSave states." }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Metering & Billing (OCMF): ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "Rigorous testing of OCMF integrations (LEM/Bauer meters), clock synchronization, and accurate energy value transmissions." }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Payments & Terminals: ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "End-to-end flows for CCV, Valina, and Castles terminals, including reconciliations, cloud terminal reconnects, and eReceipts/ReceiptHero via OCPP." }
                  ]
                }
              ]
            },
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    { "type": "text", "text": "Infrastructure: ", "marks": [{"type": "strong"}]},
                    { "type": "text", "text": "OTA/USB firmware updates and fallback mechanisms." }
                  ]
                }
              ]
            }
          ]
        },
        {
          "type": "heading",
          "attrs": { "level": 2 },
          "content": [ { "type": "text", "text": "3. Mixed (EV + Backend)" } ]
        },
        {
          "type": "paragraph",
          "content": [ { "type": "text", "text": "Validates complex edge cases requiring both domains, such as Autocharge via VehicleID and offline charging without authentication." } ]
        }
      ]
    };

    try {
        await axios.put(updateUrl, {
            fields: {
                description: adfDescription
            }
        }, {
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json"
            }
        });
        console.log(`✅ Successfully updated description for ${planKey}`);
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
