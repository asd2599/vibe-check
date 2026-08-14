-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "problemId" TEXT NOT NULL,
    "workspacePath" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "rateLimitStatus" TEXT,
    "exitCode" INTEGER,
    "sessionId" TEXT,
    "resultText" TEXT,
    "numTurns" INTEGER,
    "totalCostUsdEstimate" REAL,
    "usageInputTokens" INTEGER,
    "usageOutputTokens" INTEGER,
    "usageCacheCreationInputTokens" INTEGER,
    "usageCacheReadInputTokens" INTEGER,
    "cliReportedDurationMs" INTEGER,
    "disqualifyReason" TEXT,
    "harnessEstimateTokens" INTEGER,
    "harnessEstimateElapsedMs" INTEGER,
    "signal" TEXT,
    "stderrTail" TEXT
);
INSERT INTO "new_Run" ("cliReportedDurationMs", "disqualifyReason", "durationMs", "exitCode", "harnessEstimateElapsedMs", "harnessEstimateTokens", "id", "numTurns", "problemId", "rateLimitStatus", "resultText", "sessionId", "signal", "startedAt", "status", "stderrTail", "totalCostUsdEstimate", "usageCacheCreationInputTokens", "usageCacheReadInputTokens", "usageInputTokens", "usageOutputTokens", "workspacePath") SELECT "cliReportedDurationMs", "disqualifyReason", "durationMs", "exitCode", "harnessEstimateElapsedMs", "harnessEstimateTokens", "id", "numTurns", "problemId", "rateLimitStatus", "resultText", "sessionId", "signal", "startedAt", "status", "stderrTail", "totalCostUsdEstimate", "usageCacheCreationInputTokens", "usageCacheReadInputTokens", "usageInputTokens", "usageOutputTokens", "workspacePath" FROM "Run";
DROP TABLE "Run";
ALTER TABLE "new_Run" RENAME TO "Run";
CREATE INDEX "Run_status_idx" ON "Run"("status");
CREATE INDEX "Run_problemId_idx" ON "Run"("problemId");
CREATE INDEX "Run_startedAt_idx" ON "Run"("startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
