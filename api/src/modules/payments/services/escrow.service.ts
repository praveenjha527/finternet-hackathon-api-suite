import { Injectable, Logger } from "@nestjs/common";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BlockchainService } from "./blockchain.service";
import { ApiException } from "../../../common/exceptions";
import {
  DVPEscrowWithSettlementAbi,
  DvpEscrowContract,
} from "../../../contracts/types";

/**
 * EscrowService
 * 
 * Handles interactions with the DVPEscrowWithSettlement contract for order-based escrow payments.
 * This service manages the full order lifecycle: creation, shipping, delivery proof, and settlement.
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private provider: JsonRpcProvider | null = null;
  private signer: Wallet | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchain: BlockchainService,
  ) {
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    if (rpcUrl) {
      this.provider = new JsonRpcProvider(rpcUrl);
    }

    const pk = process.env.PRIVATE_KEY;
    if (pk && this.provider) {
      try {
        this.signer = new Wallet(pk, this.provider);
      } catch {
        this.signer = null;
      }
    }
  }

  /**
   * Get order state from the contract.
   */
  async getOrderState(
    contractAddress: string,
    orderId: bigint,
  ): Promise<{
    orderId: bigint;
    merchantId: bigint;
    merchant: string;
    buyer: string;
    token: string;
    amount: bigint;
    createdAt: bigint;
    deliveryDeadline: bigint;
    releasedAt: bigint;
    settlementScheduledAt: bigint;
    deliveryProofHash: string;
    actualDeliveryHash: string;
    status: number;
    settlementStatus: number;
    feeRate: bigint;
    autoReleaseOnProof: boolean;
    deliveryOracle: string;
  } | null> {
    if (!this.provider || !contractAddress) {
      return null;
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.provider,
      ) as unknown as DvpEscrowContract;

      return await contract.getOrder(orderId);
    } catch (err) {
      this.logger.error(
        `Failed to get order state for orderId ${orderId}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      return null;
    }
  }

  /**
   * Get delivery proof from the contract.
   */
  async getDeliveryProof(
    contractAddress: string,
    orderId: bigint,
  ): Promise<{
    proofHash: string;
    submittedAt: bigint;
    submittedBy: string;
    proofURI: string;
  } | null> {
    if (!this.provider || !contractAddress) {
      return null;
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.provider,
      ) as unknown as DvpEscrowContract;

      return await contract.getDeliveryProof(orderId);
    } catch (err) {
      this.logger.error(
        `Failed to get delivery proof for orderId ${orderId}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      return null;
    }
  }

  /**
   * Get settlement state from the contract.
   */
  async getSettlementState(
    contractAddress: string,
    orderId: bigint,
  ): Promise<{
    orderId: bigint;
    merchant: string;
    amount: bigint;
    executedAt: bigint;
    executedBy: string;
    txHash: string;
    status: number;
  } | null> {
    if (!this.provider || !contractAddress) {
      return null;
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.provider,
      ) as unknown as DvpEscrowContract;

      return await contract.getSettlement(orderId);
    } catch (err) {
      this.logger.error(
        `Failed to get settlement state for orderId ${orderId}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      return null;
    }
  }

  /**
   * Convert PaymentIntent ID to a numeric orderId for the contract.
   * 
   * Strategy: Use a hash of the intent ID to generate a deterministic uint256.
   * This ensures each PaymentIntent maps to a unique orderId.
   */
  async getOrderIdForIntent(paymentIntentId: string): Promise<bigint> {
    // For now, use a simple hash-based approach
    // In production, you might want to store a mapping in the database
    const hash = BigInt(
      "0x" +
        paymentIntentId
          .split("")
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 64),
    );
    return hash;
  }

  /**
   * Get merchantId for a merchant.
   * 
   * In the contract, merchants are identified by a numeric ID.
   * We need to map our UUID-based merchant IDs to contract merchantIds.
   * 
   * Strategy: Store contract merchantId in Merchant metadata or use a deterministic mapping.
   */
  async getContractMerchantId(merchantId: string): Promise<bigint> {
    // For hackathon: use a simple hash-based mapping
    // In production, you should store contract merchantId in the Merchant model
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new ApiException(
        "resource_missing",
        `Merchant not found: ${merchantId}`,
        404,
      );
    }

    // Check if merchant has a stored contract merchantId in metadata
    // For now, use hash-based approach
    const hash = BigInt(
      "0x" +
        merchantId
          .split("")
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 64),
    );
    return hash;
  }

  /**
   * Sync order state from contract to database.
   * 
   * This should be called periodically or when contract events are detected.
   */
  async syncOrderState(
    paymentIntentId: string,
    contractAddress: string,
  ): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });

    if (!intent) {
      this.logger.warn(
        `PaymentIntent not found for sync: ${paymentIntentId}`,
      );
      return;
    }

    const orderId = await this.getOrderIdForIntent(paymentIntentId);
    const orderState = await this.getOrderState(contractAddress, orderId);

    if (!orderState) {
      this.logger.warn(
        `Order state not found for orderId ${orderId} (intent: ${paymentIntentId})`,
      );
      return;
    }

    // Map contract OrderStatus enum to PaymentIntent status
    // OrderStatus: 0=Pending, 1=Shipped, 2=Delivered, 3=Completed, 4=Cancelled, 5=Disputed
    // We'll need to update PaymentIntent status based on orderState.status

    // Store order state in metadata for now
    const metadata = (intent.metadata as Record<string, unknown>) || {};
    metadata.orderState = {
      orderId: orderState.orderId.toString(),
      status: orderState.status,
      settlementStatus: orderState.settlementStatus,
      deliveryDeadline: orderState.deliveryDeadline.toString(),
      releasedAt: orderState.releasedAt.toString(),
      settlementScheduledAt: orderState.settlementScheduledAt.toString(),
    };

    await this.prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: { metadata: metadata as unknown as Prisma.InputJsonValue },
    });

    this.logger.log(
      `Synced order state for paymentIntent ${paymentIntentId}, orderId ${orderId}, status ${orderState.status}`,
    );
  }
}

