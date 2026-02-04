-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "fiatPaymentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "fiatPaymentStatus" TEXT,
ADD COLUMN     "onRampCompletedAt" TIMESTAMP(3),
ADD COLUMN     "onRampStatus" TEXT,
ADD COLUMN     "onRampTxId" TEXT,
ADD COLUMN     "paymentProcessorTxId" TEXT,
ADD COLUMN     "paymentProcessorType" TEXT,
ADD COLUMN     "stablecoinAmount" TEXT,
ADD COLUMN     "stablecoinCurrency" TEXT;
