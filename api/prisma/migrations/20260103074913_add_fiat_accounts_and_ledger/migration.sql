-- CreateTable
CREATE TABLE "MerchantFiatAccount" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "availableBalance" TEXT NOT NULL DEFAULT '0',
    "pendingBalance" TEXT NOT NULL DEFAULT '0',
    "reservedBalance" TEXT NOT NULL DEFAULT '0',
    "accountNumber" TEXT NOT NULL,
    "routingNumber" TEXT,
    "bankName" TEXT,
    "accountHolderName" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantFiatAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "fiatAccountId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "transactionType" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balanceBefore" TEXT NOT NULL,
    "balanceAfter" TEXT NOT NULL,
    "description" TEXT,
    "settlementMethod" TEXT,
    "settlementDestination" TEXT,
    "settlementTxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantFiatAccount_merchantId_key" ON "MerchantFiatAccount"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantFiatAccount_accountNumber_key" ON "MerchantFiatAccount"("accountNumber");

-- CreateIndex
CREATE INDEX "MerchantFiatAccount_merchantId_idx" ON "MerchantFiatAccount"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantFiatAccount_currency_idx" ON "MerchantFiatAccount"("currency");

-- CreateIndex
CREATE INDEX "LedgerEntry_fiatAccountId_idx" ON "LedgerEntry"("fiatAccountId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentIntentId_idx" ON "LedgerEntry"("paymentIntentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionType_idx" ON "LedgerEntry"("transactionType");

-- CreateIndex
CREATE INDEX "LedgerEntry_status_idx" ON "LedgerEntry"("status");

-- CreateIndex
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "MerchantFiatAccount" ADD CONSTRAINT "MerchantFiatAccount_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_fiatAccountId_fkey" FOREIGN KEY ("fiatAccountId") REFERENCES "MerchantFiatAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
