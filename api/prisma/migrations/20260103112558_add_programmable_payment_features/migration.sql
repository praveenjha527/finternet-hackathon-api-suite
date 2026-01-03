-- AlterTable
ALTER TABLE "EscrowOrder" ADD COLUMN     "disputeRaisedAt" TEXT,
ADD COLUMN     "disputeRaisedBy" TEXT,
ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputeResolution" TEXT,
ADD COLUMN     "disputeResolutionTxHash" TEXT,
ADD COLUMN     "disputeResolvedAt" TEXT,
ADD COLUMN     "disputeWindow" TEXT,
ADD COLUMN     "releaseType" TEXT NOT NULL DEFAULT 'DELIVERY_PROOF',
ADD COLUMN     "timeLockUntil" TEXT;

-- CreateTable
CREATE TABLE "PaymentMilestone" (
    "id" TEXT NOT NULL,
    "escrowOrderId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "description" TEXT,
    "amount" TEXT NOT NULL,
    "percentage" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completionProof" TEXT,
    "completionProofURI" TEXT,
    "releasedAt" TEXT,
    "releaseTxHash" TEXT,
    "releasedBy" TEXT,
    "completedAt" TEXT,
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMilestone_escrowOrderId_idx" ON "PaymentMilestone"("escrowOrderId");

-- CreateIndex
CREATE INDEX "PaymentMilestone_paymentIntentId_idx" ON "PaymentMilestone"("paymentIntentId");

-- CreateIndex
CREATE INDEX "PaymentMilestone_status_idx" ON "PaymentMilestone"("status");

-- CreateIndex
CREATE INDEX "PaymentMilestone_createdAt_idx" ON "PaymentMilestone"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMilestone_escrowOrderId_milestoneIndex_key" ON "PaymentMilestone"("escrowOrderId", "milestoneIndex");

-- CreateIndex
CREATE INDEX "EscrowOrder_releaseType_idx" ON "EscrowOrder"("releaseType");

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_escrowOrderId_fkey" FOREIGN KEY ("escrowOrderId") REFERENCES "EscrowOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
