-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "object" TEXT NOT NULL DEFAULT 'payment_intent',
    "status" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "settlementMethod" TEXT NOT NULL,
    "settlementDestination" TEXT NOT NULL,
    "settlementStatus" TEXT,
    "contractAddress" TEXT,
    "transactionHash" TEXT,
    "chainId" INTEGER,
    "typedData" JSONB,
    "signature" TEXT,
    "signerAddress" TEXT,
    "phases" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);
