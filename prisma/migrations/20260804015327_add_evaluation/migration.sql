-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "testPassed" BOOLEAN,
    "testOutput" TEXT,
    "testExitCode" INTEGER,
    "judgeScores" JSONB,
    "judgeOverallComment" TEXT,
    "judgeModel" TEXT,
    "judgeCostUsd" REAL,
    "judgeInputTokens" INTEGER,
    "judgeOutputTokens" INTEGER,
    "evaluatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evaluation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_runId_key" ON "Evaluation"("runId");

-- CreateIndex
CREATE INDEX "Evaluation_runId_idx" ON "Evaluation"("runId");
