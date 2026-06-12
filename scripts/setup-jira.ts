/**
 * Interactive Jira Cloud Setup CLI
 *
 * Walks the user through:
 *   1. Jira Cloud URL (e.g., https://your-domain.atlassian.net)
 *   2. Email (Atlassian account)
 *   3. API Token (from https://id.atlassian.com/manage-profile/security/api-tokens)
 *   4. Validates connection → shows user display name
 *   5. Lists available projects (name, key, type)
 *   6. Lets user pick one
 *   7. Saves to dashboard-config.json
 *
 * Usage: npx tsx scripts/setup-jira.ts [--separate]
 *   --separate  Write a standalone jira-config.json instead of merging into dashboard-config.json
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import axios from "axios";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DASHBOARD_CONFIG = path.join(PROJECT_ROOT, "dashboard-config.json");
const EXAMPLE_CONFIG = path.join(PROJECT_ROOT, "dashboard-config.example.json");

interface JiraProject {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    style: string;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    const separate = process.argv.includes("--separate");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║     Jira Cloud Interactive Setup         ║");
    console.log("╚══════════════════════════════════════════╝\n");
    console.log("Tip: Get your API token at:");
    console.log("  https://id.atlassian.com/manage-profile/security/api-tokens\n");

    // ── 1. Gather credentials ──
    const baseUrl = (await ask(rl, "Jira Cloud URL [https://your-domain.atlassian.net]: ")).trim() ||
        "https://your-domain.atlassian.net";
    const email = (await ask(rl, "Your Atlassian email: ")).trim();
    const apiToken = (await ask(rl, "API Token: ")).trim();

    if (!email || !apiToken) {
        console.log("\n❌ Email and API token are required. Aborting.");
        rl.close();
        process.exit(1);
    }

    const auth = { username: email, password: apiToken };
    const apiRoot = baseUrl.replace(/\/+$/, "") + "/rest/api/3";

    // ── 2. Validate connection ──
    console.log("\n⏳ Connecting to Jira...");
    let displayName = "";
    try {
        const me = await axios.get(`${apiRoot}/myself`, { auth, timeout: 10000 });
        displayName = me.data.displayName;
        console.log(`✓ Connected as "${displayName}" (${me.data.accountType})\n`);
    } catch (e: any) {
        if (e.response?.status === 401) {
            console.log("❌ Authentication failed. Check your email and API token.");
        } else if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND") {
            console.log(`❌ Cannot reach ${baseUrl}. Check the URL.`);
        } else {
            console.log(`❌ Connection failed: ${e.message}`);
        }
        rl.close();
        process.exit(1);
    }

    // ── 3. List projects ──
    console.log("⏳ Fetching projects...");
    let projects: JiraProject[] = [];
    try {
        const resp = await axios.get(`${apiRoot}/project`, { auth, timeout: 10000 });
        projects = resp.data as JiraProject[];
    } catch (e: any) {
        console.log(`❌ Failed to list projects: ${e.message}`);
        rl.close();
        process.exit(1);
    }

    if (projects.length === 0) {
        console.log("❌ No projects found. Check your Jira permissions.");
        rl.close();
        process.exit(1);
    }

    console.log(`\nFound ${projects.length} project(s):\n`);
    const typeIcons: Record<string, string> = { software: "🖥", service_desk: "🎫", business: "📋" };
    projects.forEach((p, i) => {
        const icon = typeIcons[p.projectTypeKey] || "📌";
        console.log(`  ${String(i + 1).padStart(2)}. ${icon} ${p.key.padEnd(10)} ${p.name} (${p.projectTypeKey.replace("_", " ")})`);
    });

    // ── 4. Pick project ──
    let selected: JiraProject;
    if (projects.length === 1) {
        selected = projects[0];
        console.log(`\n→ Auto-selected: ${selected.name} (${selected.key})`);
    } else {
        const answer = await ask(rl, `\nSelect project [1-${projects.length}]: `);
        const idx = parseInt(answer.trim(), 10);
        if (isNaN(idx) || idx < 1 || idx > projects.length) {
            console.log("❌ Invalid selection. Aborting.");
            rl.close();
            process.exit(1);
        }
        selected = projects[idx - 1];
    }

    // ── 5. Gather all config ──
    const fullConfig: Record<string, unknown> = {
        jiraBaseUrl: baseUrl,
        jiraEmail: email,
        jiraApiToken: apiToken,
        jiraProjectKey: selected.key,
    };

    // ── 5b. Xray Cloud setup (optional) ──
    console.log("\n" + "─".repeat(50));
    console.log("  Xray Test Management (optional)");
    console.log("─".repeat(50));
    console.log("\nXray uploads test results to Jira automatically after each run.");
    console.log("Get credentials at: https://xray.cloud.getxray.app → API Keys\n");

    const setupXray = (await ask(rl, "Setup Xray Cloud? (y/N): ")).trim().toLowerCase();
    if (setupXray === "y" || setupXray === "yes") {
        const xid = (await ask(rl, "Xray Client ID: ")).trim();
        const xsecret = (await ask(rl, "Xray Client Secret: ")).trim();
        if (xid && xsecret) {
            console.log("\n⏳ Validating Xray credentials...");
            try {
                const authResp = await axios.post(
                    "https://xray.cloud.getxray.app/api/v2/authenticate",
                    { client_id: xid, client_secret: xsecret },
                    { timeout: 10000, headers: { "Content-Type": "application/json" } }
                );
                if (authResp.data) {
                    console.log("✓ Xray Cloud authenticated");
                }
            } catch (e: any) {
                console.log(`⚠ Xray validation failed: ${e.response?.status || e.message} (saving anyway)`);
            }
            fullConfig.xrayClientId = xid;
            fullConfig.xrayClientSecret = xsecret;
        }
    } else {
        console.log("  Skipping Xray. Add later in dashboard-config.json.");
    }

    // ── 6. Save configuration ──
    if (separate) {
        const outPath = path.join(PROJECT_ROOT, "jira-config.json");
        fs.writeFileSync(outPath, JSON.stringify(fullConfig, null, 2) + "\n");
        console.log(`\n✓ Saved to ${outPath}`);
    } else {
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(DASHBOARD_CONFIG)) {
            try { existing = JSON.parse(fs.readFileSync(DASHBOARD_CONFIG, "utf-8")); } catch {}
        } else if (fs.existsSync(EXAMPLE_CONFIG)) {
            try { existing = JSON.parse(fs.readFileSync(EXAMPLE_CONFIG, "utf-8")); } catch {}
        }

        const merged = { ...existing, ...fullConfig };
        fs.writeFileSync(DASHBOARD_CONFIG, JSON.stringify(merged, null, 2) + "\n");

        console.log(`\n✓ Saved to ${DASHBOARD_CONFIG}`);
        console.log(`  Jira URL  : ${baseUrl}`);
        console.log(`  User      : ${displayName}`);
        console.log(`  Project   : ${selected.key} — ${selected.name}`);
        if (fullConfig.xrayClientId) {
            console.log(`  Xray      : ${fullConfig.xrayClientId} ✓`);
        }
    }

    console.log("");
    rl.close();
}

main().catch((e) => {
    console.error("Fatal error:", e.message);
    process.exit(1);
});
