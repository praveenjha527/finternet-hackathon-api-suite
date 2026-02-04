import { Injectable, Logger } from "@nestjs/common";
import { Contract, JsonRpcProvider, Wallet, parseUnits, Signature, ContractTransactionResponse, MaxUint256 } from "ethers";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BlockchainService } from "./blockchain.service";
import { ApiException } from "../../../common/exceptions";
import {
  DVPEscrowWithSettlementAbi,
  DvpEscrowContract,
} from "../../../contracts/types";

// ERC20 ABI for token approval
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function transfer(address to, uint256 amount) external returns (bool)",
] as const;

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

    // Use stored contractMerchantId if available, otherwise fall back to hash-based approach
    if (merchant.contractMerchantId) {
      return BigInt(merchant.contractMerchantId);
    }

    // Fallback: hash-based approach for backward compatibility
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
   * Submit delivery proof on the escrow contract.
   * This must be called before executeSettlement can be called.
   * 
   * @param contractAddress - Contract address
   * @param orderId - Order ID
   * @param proofHash - Delivery proof hash (bytes32)
   * @param proofURI - URI to delivery proof
   * @param submittedBy - Address submitting the proof (for signing)
   * @returns Transaction hash
   */
  async submitDeliveryProof(
    contractAddress: string,
    orderId: bigint,
    proofHash: string,
    proofURI: string,
    submittedBy: string,
  ): Promise<{ hash: string }> {
    if (!this.signer || !contractAddress || !this.provider) {
      throw new ApiException(
        "contract_execution_failed",
        "Cannot submit delivery proof: signer, contract address, or provider not available",
        500,
      );
    }
  
    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer,
      ) as unknown as DvpEscrowContract;
  
      // Get chainId from provider
      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
  
      // Get current nonce for this orderId from the contract
      const nonce = await contract.deliveryOracleNonce(orderId);
  
      // FIXED: Use deadline instead of timestamp for signature validation
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const deadline = BigInt(currentTimestamp + 300); // 5 minutes deadline
  
      // Build EIP-712 typed data matching the FIXED contract
      const domain = {
        name: "DVPEscrow",
        version: "1",
        chainId: chainId,
        verifyingContract: contractAddress
      };
  
      const types = {
        DeliveryProof: [
          { name: "orderId", type: "uint256" },
          { name: "deliveryHash", type: "bytes32" },
          { name: "deadline", type: "uint256" },  // CHANGED: deadline instead of timestamp
          { name: "nonce", type: "uint256" }
        ]
      };
  
      const message = {
        orderId: orderId,
        deliveryHash: proofHash,
        deadline: deadline,  // CHANGED: deadline instead of timestamp
        nonce: nonce
      };
  
      // Sign the typed data
      const signature = await this.signer.signTypedData(domain, types, message);
      const sig = Signature.from(signature);
  
      this.logger.log(
        `Submitting delivery proof for orderId ${orderId} with deadline ${deadline}, nonce ${nonce}`,
      );
  
      // Call submitDeliveryProof on contract with NEW signature
      const txResponse = await contract.submitDeliveryProof(
        orderId,
        proofHash,
        proofURI || "",
        deadline,  // ADDED: deadline parameter
        sig.v,
        sig.r,
        sig.s,
      ) as unknown as ContractTransactionResponse;
  
      // Wait for confirmation
      const receipt = await txResponse.wait();
      if (!receipt) {
        throw new Error("Transaction receipt not received");
      }
  
      this.logger.log(
        `Delivery proof confirmed at block ${receipt.blockNumber} for orderId ${orderId}`,
      );
  
      return { hash: txResponse.hash };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(
        `Failed to submit delivery proof for orderId ${orderId}: ${message}`,
      );
      throw new ApiException(
        "contract_execution_failed",
        `Failed to submit delivery proof: ${message}`,
        500,
      );
    }
  }

  /**
   * Execute settlement on the escrow contract.
   * This transfers funds from escrow to the merchant's Ethereum address.
   * 
   * Note: For off-ramp settlements, the contract transfers to the merchant's address on-chain.
   * The actual fiat destination is handled separately in the off-ramp processing.
   * 
   * @param contractAddress - Contract address
   * @param orderId - Order ID
   * @param merchantId - Merchant ID (to get merchant's Ethereum address from contract)
   * @param offrampData - Optional offramp data (can contain fiat destination info)
   */
  async executeSettlement(
    contractAddress: string,
    orderId: bigint,
    merchantId: string,
    offrampData: string = "0x",
  ): Promise<{ hash: string }> {
    if (!this.signer || !contractAddress) {
      throw new ApiException(
        "contract_execution_failed",
        "Cannot execute settlement: signer or contract address not available",
        500,
      );
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer,
      ) as unknown as DvpEscrowContract;

      // Get merchant's Ethereum address from contract
      const contractMerchantId = await this.getContractMerchantId(merchantId);
      const merchantOnChain = await contract.merchants(contractMerchantId);
      const merchantAddress = merchantOnChain.merchantAddress;

      if (!merchantAddress || merchantAddress === "0x0000000000000000000000000000000000000000") {
        throw new ApiException(
          "contract_execution_failed",
          `Invalid merchant address from contract: ${merchantAddress}`,
          500,
        );
      }

      this.logger.log(
        `Executing settlement for orderId ${orderId}, transferring to merchant address: ${merchantAddress}`,
      );

      const tx = await contract.executeSettlement(
        orderId,
        merchantAddress, // Use merchant's Ethereum address, not fiat destination
        offrampData,
      );

      this.logger.log(
        `Settlement execution transaction submitted: ${tx.hash} for orderId ${orderId}`,
      );

      return { hash: tx.hash };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(
        `Failed to execute settlement for orderId ${orderId}: ${message}`,
      );
      throw new ApiException(
        "contract_execution_failed",
        `Failed to execute settlement: ${message}`,
        500,
      );
    }
  }

  /**
   * Confirm settlement on the escrow contract.
   * This is called after off-ramp processing is complete.
   */
  async confirmSettlement(
    contractAddress: string,
    orderId: bigint,
    fiatTransactionHash: string,
  ): Promise<{ hash: string }> {
    if (!this.signer || !contractAddress) {
      throw new ApiException(
        "contract_execution_failed",
        "Cannot confirm settlement: signer or contract address not available",
        500,
      );
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer,
      ) as unknown as DvpEscrowContract;

      const tx = await contract.confirmSettlement(orderId, fiatTransactionHash);

      this.logger.log(
        `Settlement confirmation transaction submitted: ${tx.hash} for orderId ${orderId}`,
      );

      return { hash: tx.hash };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(
        `Failed to confirm settlement for orderId ${orderId}: ${message}`,
      );
      throw new ApiException(
        "contract_execution_failed",
        `Failed to confirm settlement: ${message}`,
        500,
      );
    }
  }

  /**
   * Get merchant balance from the escrow contract.
   */
  async getMerchantBalance(
    contractAddress: string,
    merchantAddress: string,
    tokenAddress: string,
  ): Promise<bigint> {
    if (!this.provider || !contractAddress) {
      return BigInt(0);
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.provider,
      ) as any;

      const balance = await contract.merchantBalances(merchantAddress, tokenAddress);
      return balance;
    } catch (err) {
      this.logger.error(
        `Failed to get merchant balance for ${merchantAddress}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      return BigInt(0);
    }
  }

  /**
   * Approve ERC20 token for escrow contract.
   * 
   * @param tokenAddress - ERC20 token address (e.g., USDC)
   * @param escrowContractAddress - Escrow contract address
   * @param amount - Amount to approve (use MaxUint256 for unlimited)
   * @returns Transaction hash
   */
  async approveToken(
    tokenAddress: string,
    escrowContractAddress: string,
    amount: bigint = MaxUint256,
  ): Promise<{ hash: string }> {
    if (!this.signer || !tokenAddress || !escrowContractAddress) {
      throw new ApiException(
        "contract_execution_failed",
        "Cannot approve token: signer, token address, or contract address not available",
        500,
      );
    }

    try {
      const tokenContract = new Contract(
        tokenAddress,
        ERC20_ABI,
        this.signer,
      ) as any;

      // Check current allowance
      const currentAllowance = await tokenContract.allowance(
        this.signer.address,
        escrowContractAddress,
      );

      // If allowance is sufficient, skip approval
      if (currentAllowance >= amount) {
        this.logger.log(
          `Token already approved: ${currentAllowance.toString()} >= ${amount.toString()}`,
        );
        return { hash: "0x0000000000000000000000000000000000000000000000000000000000000000" };
      }

      this.logger.log(
        `Approving ${amount.toString()} tokens for escrow contract ${escrowContractAddress}`,
      );

      const txResponse = await tokenContract.approve(escrowContractAddress, amount) as ContractTransactionResponse;
      const receipt = await txResponse.wait();

      this.logger.log(
        `Token approval transaction confirmed: ${txResponse.hash} at block ${receipt?.blockNumber || 0}`,
      );

      return { hash: txResponse.hash };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(`Failed to approve token: ${message}`);
      throw new ApiException(
        "contract_execution_failed",
        `Failed to approve token: ${message}`,
        500,
      );
    }
  }

  /**
   * Deposit stablecoins into escrow and create order.
   * 
   * This method:
   * 1. Approves USDC token for escrow contract (if needed)
   * 2. Creates escrow order on-chain (which transfers tokens to escrow)
   * 
   * Note: The escrow contract's createOrder function handles the token transfer internally
   * after approval.
   * 
   * @param params - Order creation parameters
   * @returns Transaction hash
   */
  async depositAndCreateOrder(params: {
    merchantId: bigint;
    orderId: bigint;
    buyer: string;
    tokenAddress: string;
    amount: string;
    decimals: number;
    deliveryPeriod: number;
    expectedDeliveryHash: string;
    autoRelease: boolean;
    deliveryOracle: string;
    contractAddress: string;
  }): Promise<{ hash: string }> {
    if (!this.signer || !params.contractAddress) {
      throw new ApiException(
        "contract_execution_failed",
        "Cannot create order: signer or contract address not available",
        500,
      );
    }

    try {
      // Step 1: Approve token for escrow contract (if needed)
      // Use MaxUint256 for unlimited approval (standard practice)
      await this.approveToken(
        params.tokenAddress,
        params.contractAddress,
        MaxUint256,
      );

      // Step 2: Create order on escrow contract (which transfers tokens)
      const contract = new Contract(
        params.contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer,
      ) as unknown as DvpEscrowContract;

      const amountInWei = parseUnits(params.amount, params.decimals);

      this.logger.log(
        `Creating escrow order ${params.orderId.toString()} for merchant ${params.merchantId.toString()}, amount: ${params.amount} tokens`,
      );

      const txResponse = await contract.createOrder(
        params.merchantId,
        params.orderId,
        params.buyer,
        params.tokenAddress,
        amountInWei,
        params.deliveryPeriod,
        params.expectedDeliveryHash,
        params.autoRelease,
        params.deliveryOracle,
      ) as unknown as ContractTransactionResponse;

      this.logger.log(
        `Escrow order creation transaction submitted: ${txResponse.hash} for orderId ${params.orderId.toString()}`,
      );

      // Wait for transaction to be mined
      const receipt = await txResponse.wait();

      this.logger.log(
        `Escrow order created: ${txResponse.hash} at block ${receipt?.blockNumber || 0}`,
      );

      return { hash: txResponse.hash };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(
        `Failed to deposit and create order for orderId ${params.orderId.toString()}: ${message}`,
      );
      throw new ApiException(
        "contract_execution_failed",
        `Failed to deposit and create order: ${message}`,
        500,
      );
    }
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

