-- AlterTable
ALTER TABLE "Run" ADD COLUMN "harnessEstimateCompactTokens" INTEGER;
ALTER TABLE "Run" ADD COLUMN "harnessEstimateCostUsd" REAL;
ALTER TABLE "Run" ADD COLUMN "harnessEstimateUsageByModel" JSONB;
