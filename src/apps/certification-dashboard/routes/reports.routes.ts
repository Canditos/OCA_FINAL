// ══════════════════════════════════════════════════════════════
// Reports Routes — View logs and download reports (v3 - 2026-05-30)
// Uses getReports() + downloadReports() and extracts the detailed log file
// ══════════════════════════════════════════════════════════════
console.log("[reports.routes] Module loaded - using getReports/downloadReports and yauzl");

import { Router } from "express";
import { OcttClient } from "../../../connectors/octt/index.js";
import { effectiveConfig } from "../config/dashboard.config.js";
import { log } from "./logs.routes.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import yauzl from "yauzl";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extracts a specific target .log file content from a ZIP buffer.
 */
function unzipTargetLogFile(zipBuffer: Buffer, targetFileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const targetLower = targetFileName.toLowerCase();
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) return reject(err);
            if (!zipfile) return reject(new Error("Could not read ZIP file"));
            let found = false;
            zipfile.readEntry();
            zipfile.on("entry", (entry) => {
                const entryName = entry.fileName;
                const entryBaseName = path.basename(entryName).toLowerCase();
                if (entryBaseName === targetLower) {
                    found = true;
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) return reject(err);
                        if (!readStream) return reject(new Error("Could not open read stream"));
                        const chunks: Buffer[] = [];
                        readStream.on("data", (chunk) => chunks.push(chunk));
                        readStream.on("end", () => {
                            resolve(Buffer.concat(chunks).toString("utf8"));
                        });
                        readStream.on("error", reject);
                    });
                } else {
                    zipfile.readEntry();
                }
            });
            zipfile.on("end", () => {
                if (!found) reject(new Error(`Target log file ${targetFileName} not found in ZIP archive`));
            });
            zipfile.on("error", reject);
        });
    });
}

router.post("/view-log", async (req, res) => {
    const { testcaseName, configurationName } = req.body;
    try {
        const octt = new OcttClient(effectiveConfig.octt);
        const reports = await octt.getReportsFiltered({
            testcase_name: [testcaseName],
            configuration_name: [configurationName || "AUT_SID_SAT"]
        });
        if (!reports.data || reports.data.length === 0) {
            res.status(404).json({ ok: false, error: `No reports found for ${testcaseName}` });
            return;
        }
        const latestReport = reports.data[0];
        const logfileName = path.basename(latestReport.logfile);
        const configName = latestReport.configuration;

        // Download ZIP file from OCTT which contains the raw log
        const zipContent = await octt.downloadReports({
            format: "ZIP",
            configuration_name: configName,
            logfile_name: logfileName
        });

        // Unzip and extract the detailed .log file content
        const logContent = await unzipTargetLogFile(zipContent, logfileName);

        res.json({ ok: true, content: logContent });
    } catch (e: any) {
        log("warn", `View log failed: ${e.message}`, "reports");
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post("/download", async (req, res) => {
    const { testcaseName, format, configurationName } = req.body;
    try {
        const octt = new OcttClient(effectiveConfig.octt);
        const reports = await octt.getReportsFiltered({
            testcase_name: [testcaseName],
            configuration_name: [configurationName || "AUT_SID_SAT"]
        });
        if (!reports.data || reports.data.length === 0) {
            res.status(404).json({ ok: false, error: `No reports found for ${testcaseName}` });
            return;
        }
        const latestReport = reports.data[0];
        const logfileName = path.basename(latestReport.logfile);
        const configName = latestReport.configuration;

        // Download ZIP file from OCTT which contains the raw log
        const zipContent = await octt.downloadReports({
            format: "ZIP",
            configuration_name: configName,
            logfile_name: logfileName
        });

        // Unzip and extract the detailed .log file content
        const logContent = await unzipTargetLogFile(zipContent, logfileName);

        // Save as a .log file in the reports directory so the user gets the actual log
        const filename = `${testcaseName}_Log_${Date.now()}.log`;
        const reportsDir = path.join(__dirname, "../public/reports");
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const filepath = path.join(reportsDir, filename);
        await fs.promises.writeFile(filepath, logContent, "utf8");

        res.json({ ok: true, filename, size: logContent.length });
    } catch (e: any) {
        log("warn", `Download failed: ${e.message}`, "reports");
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
