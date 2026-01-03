-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "contractMerchantId" TEXT,
ADD COLUMN     "merchantAddress" TEXT;

-- CreateTable
CREATE TABLE "EscrowOrder" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "buyerAddress" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "deliveryPeriod" INTEGER NOT NULL,
    "deliveryDeadline" TEXT NOT NULL,
    "expectedDeliveryHash" TEXT,
    "actualDeliveryHash" TEXT,
    "autoReleaseOnProof" BOOLEAN NOT NULL DEFAULT true,
    "deliveryOracle" TEXT,
    "orderStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "settlementStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createTxHash" TEXT,
    "releasedAt" TEXT,
    "settlementScheduledAt" TEXT,

    CONSTRAINT "EscrowOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProof" (
    "id" TEXT NOT NULL,
    "escrowOrderId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "proofURI" TEXT,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TEXT NOT NULL,
    "submitTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementExecution" (
    "id" TEXT NOT NULL,
    "escrowOrderId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "merchantAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "executedAt" TEXT NOT NULL,
    "executedBy" TEXT NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXECUTED',
    "offrampDestination" TEXT,
    "offrampData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscrowOrder_paymentIntentId_key" ON "EscrowOrder"("paymentIntentId");

-- CreateIndex
CREATE INDEX "EscrowOrder_paymentIntentId_idx" ON "EscrowOrder"("paymentIntentId");

-- CreateIndex
CREATE INDEX "EscrowOrder_merchantId_idx" ON "EscrowOrder"("merchantId");

-- CreateIndex
CREATE INDEX "EscrowOrder_orderId_idx" ON "EscrowOrder"("orderId");

-- CreateIndex
CREATE INDEX "EscrowOrder_orderStatus_idx" ON "EscrowOrder"("orderStatus");

-- CreateIndex
CREATE INDEX "EscrowOrder_settlementStatus_idx" ON "EscrowOrder"("settlementStatus");

-- CreateIndex
CREATE INDEX "EscrowOrder_contractAddress_idx" ON "EscrowOrder"("contractAddress");

-- CreateIndex
CREATE INDEX "EscrowOrder_buyerAddress_idx" ON "EscrowOrder"("buyerAddress");

-- CreateIndex
CREATE INDEX "EscrowOrder_createdAt_idx" ON "EscrowOrder"("createdAt");

-- CreateIndex
CREATE INDEX "DeliveryProof_escrowOrderId_idx" ON "DeliveryProof"("escrowOrderId");

-- CreateIndex
CREATE INDEX "DeliveryProof_paymentIntentId_idx" ON "DeliveryProof"("paymentIntentId");

-- CreateIndex
CREATE INDEX "DeliveryProof_proofHash_idx" ON "DeliveryProof"("proofHash");

-- CreateIndex
CREATE INDEX "DeliveryProof_submittedBy_idx" ON "DeliveryProof"("submittedBy");

-- CreateIndex
CREATE INDEX "DeliveryProof_createdAt_idx" ON "DeliveryProof"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementExecution_escrowOrderId_key" ON "SettlementExecution"("escrowOrderId");

-- CreateIndex
CREATE INDEX "SettlementExecution_escrowOrderId_idx" ON "SettlementExecution"("escrowOrderId");

-- CreateIndex
CREATE INDEX "SettlementExecution_paymentIntentId_idx" ON "SettlementExecution"("paymentIntentId");

-- CreateIndex
CREATE INDEX "SettlementExecution_merchantId_idx" ON "SettlementExecution"("merchantId");

-- CreateIndex
CREATE INDEX "SettlementExecution_txHash_idx" ON "SettlementExecution"("txHash");

-- CreateIndex
CREATE INDEX "SettlementExecution_status_idx" ON "SettlementExecution"("status");

-- CreateIndex
CREATE INDEX "SettlementExecution_createdAt_idx" ON "SettlementExecution"("createdAt");

-- AddForeignKey
ALTER TABLE "EscrowOrder" ADD CONSTRAINT "EscrowOrder_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowOrder" ADD CONSTRAINT "EscrowOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_escrowOrderId_fkey" FOREIGN KEY ("escrowOrderId") REFERENCES "EscrowOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementExecution" ADD CONSTRAINT "SettlementExecution_escrowOrderId_fkey" FOREIGN KEY ("escrowOrderId") REFERENCES "EscrowOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
