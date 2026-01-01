/*
  Warnings:

  - Added the required column `merchantId` to the `PaymentIntent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "merchantId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" TEXT,
    "currency" TEXT,
    "blockchainTxHash" TEXT,
    "blockchainTxStatus" TEXT,
    "contractAddress" TEXT,
    "chainId" INTEGER,
    "blockNumber" BIGINT,
    "blockTimestamp" TIMESTAMP(3),
    "settlementMethod" TEXT,
    "settlementDestination" TEXT,
    "settlementTxId" TEXT,
    "settlementStatus" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "phase" TEXT,
    "phaseStatus" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_apiKey_key" ON "Merchant"("apiKey");

-- CreateIndex
CREATE INDEX "AuditLog_paymentIntentId_idx" ON "AuditLog"("paymentIntentId");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_idx" ON "AuditLog"("merchantId");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

-- CreateIndex
CREATE INDEX "AuditLog_category_idx" ON "AuditLog"("category");

-- CreateIndex
CREATE INDEX "AuditLog_blockchainTxHash_idx" ON "AuditLog"("blockchainTxHash");

-- CreateIndex
CREATE INDEX "AuditLog_settlementTxId_idx" ON "AuditLog"("settlementTxId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
