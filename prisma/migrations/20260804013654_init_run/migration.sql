-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
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

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- CreateIndex
CREATE INDEX "Run_problemId_idx" ON "Run"("problemId");

-- CreateIndex
CREATE INDEX "Run_startedAt_idx" ON "Run"("startedAt");
