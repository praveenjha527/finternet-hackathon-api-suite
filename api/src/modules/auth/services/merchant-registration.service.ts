import { Injectable, Logger } from "@nestjs/common";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  Signature,
  isAddress,
  ContractTransactionResponse,
} from "ethers";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../prisma/prisma.service";
import { ApiException } from "../../../common/exceptions";
import {
  DVPEscrowWithSettlementAbi,
  DvpEscrowContract,
} from "../../../contracts/types";
import { buildMerchantInitTypedData } from "../../../schema/merchant-init.schema";

export interface MerchantRegistrationParams {
  merchantId: bigint | string | number;
  merchantAddress: string;
  contractAddress: string;
  kybData?: Record<string, unknown>;
}

export interface MerchantRegistrationResult {
  success: boolean;
  merchantId: bigint | string | number;
  merchantAddress: string;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
}

export interface MerchantOnChainData {
  merchantAddress: string;
  isActive: boolean;
  isKybVerified: boolean;
  totalOrders: bigint;
  successfulDeliveries: bigint;
  disputes: bigint;
}

/**
 * MerchantRegistrationService
 * 
 * Handles on-chain merchant registration for escrow contracts.
 * Manages EIP-712 signing and contract interaction for merchant initialization.
 */
@Injectable()
export class MerchantRegistrationService {
  private readonly logger = new Logger(MerchantRegistrationService.name);
  private provider: JsonRpcProvider | null = null;
  private signer: Wallet | null = null;
  private chainId: number = 11155111; // Sepolia default

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const rpcUrl = this.configService.get<string>("SEPOLIA_RPC_URL");
    if (rpcUrl) {
      this.provider = new JsonRpcProvider(rpcUrl);
    }

    const privateKey = this.configService.get<string>("PRIVATE_KEY");
    if (privateKey && this.provider) {
      try {
        this.signer = new Wallet(privateKey, this.provider);
      } catch (error) {
        this.logger.warn("Failed to initialize wallet, merchant registration will be mocked");
        this.signer = null;
      }
    }
  }

  /**
   * Check if service is in mock mode (no blockchain connection)
   */
  isMockMode(): boolean {
    return !this.provider || !this.signer;
  }

  /**
   * Initialize the service (fetch chain ID)
   */
  async initialize(): Promise<void> {
    if (this.provider) {
      try {
        const network = await this.provider.getNetwork();
        this.chainId = Number(network.chainId);
        this.logger.log(`Initialized with chain ID: ${this.chainId}`);
      } catch (error) {
        this.logger.warn("Failed to fetch chain ID, using default");
      }
    }
  }

  /**
   * Register a merchant on-chain with EIP-712 signature
   */
  async registerMerchant(
    params: MerchantRegistrationParams,
  ): Promise<MerchantRegistrationResult> {
    const { merchantId, merchantAddress, contractAddress, kybData } = params;

    try {
      // Validate merchant address
      if (!isAddress(merchantAddress)) {
        throw new Error(`Invalid merchant address: ${merchantAddress}`);
      }

      if (!isAddress(contractAddress)) {
        throw new Error(`Invalid contract address: ${contractAddress}`);
      }

      // Mock mode: return success without blockchain interaction
      if (this.isMockMode()) {
        this.logger.log(
          `Mock mode: Merchant registration skipped for merchant ${merchantId}`,
        );
        return {
          success: true,
          merchantId,
          merchantAddress,
          transactionHash: "mock_tx_hash",
        };
      }

      // Validate KYB (optional, can be implemented separately)
      // For now, we'll skip KYB validation in the registration service
      // It should be handled at the application level before calling this service

      // Get contract instance
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer!,
      ) as unknown as DvpEscrowContract;

      // Check if merchant already exists
      try {
        const existingMerchant = await contract.merchants(
          BigInt(merchantId.toString()),
        );
        if (existingMerchant.isActive) {
          this.logger.warn(
            `Merchant ${merchantId} already registered on-chain`,
          );
          return {
            success: true,
            merchantId,
            merchantAddress,
            transactionHash: "already_registered",
          };
        }
      } catch (error) {
        // Merchant doesn't exist, proceed with registration
        this.logger.log(`Merchant ${merchantId} not found on-chain, proceeding with registration`);
      }

      // Get current nonce for merchant
      const nonce = await contract.merchantNonce(BigInt(merchantId.toString()));

      // Set signature deadline (5 minutes from now)
      const signatureDeadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      // Build EIP-712 typed data
      const typedData = buildMerchantInitTypedData({
        merchantId: BigInt(merchantId.toString()),
        merchantAddress,
        nonce,
        signatureDeadline,
        chainId: this.chainId,
        verifyingContract: contractAddress,
      });

      // Sign with Finternet private key
      // ethers v6 expects types WITHOUT EIP712Domain
      const { EIP712Domain, ...primaryTypes } = typedData.types;

      const signature = await this.signer!.signTypedData(
        typedData.domain as never,
        primaryTypes as never,
        typedData.message as never,
      );

      // Split signature into v, r, s components
      const sig = Signature.from(signature);

      // Call initializeMerchant on contract
      // Note: Type definition says it returns { hash: string }, but ethers actually returns ContractTransactionResponse
      const txResponse = (await contract.initializeMerchant(
        BigInt(merchantId.toString()),
        merchantAddress,
        signatureDeadline,
        sig.v,
        sig.r,
        sig.s,
      )) as unknown as ContractTransactionResponse;

      this.logger.log(
        `Merchant registration transaction submitted: ${txResponse.hash}`,
      );

      // Wait for transaction confirmation
      const receipt = await txResponse.wait();

      if (!receipt) {
        throw new Error("Transaction receipt not received");
      }

      this.logger.log(
        `Merchant ${merchantId} registered successfully on-chain at block ${receipt.blockNumber}`,
      );

      return {
        success: true,
        merchantId,
        merchantAddress,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Failed to register merchant ${merchantId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        merchantId,
        merchantAddress,
        error: errorMessage,
      };
    }
  }

  /**
   * Get merchant details from on-chain contract
   */
  async getMerchantOnChain(
    merchantId: bigint | string | number,
    contractAddress: string,
  ): Promise<MerchantOnChainData | null> {
    if (this.isMockMode()) {
      this.logger.log(`Mock mode: Returning null for merchant ${merchantId}`);
      return null;
    }

    try {
      if (!isAddress(contractAddress)) {
        throw new Error(`Invalid contract address: ${contractAddress}`);
      }

      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.provider!,
      ) as unknown as DvpEscrowContract;

      const merchant = await contract.merchants(BigInt(merchantId.toString()));

      return {
        merchantAddress: merchant.merchantAddress,
        isActive: merchant.isActive,
        isKybVerified: merchant.isKybVerified,
        totalOrders: merchant.totalOrders,
        successfulDeliveries: merchant.successfulDeliveries,
        disputes: merchant.disputes,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Failed to get merchant ${merchantId} from chain: ${errorMessage}`,
      );
      return null;
    }
  }

  /**
   * Batch register multiple merchants
   */
  async batchRegisterMerchants(
    merchants: MerchantRegistrationParams[],
  ): Promise<MerchantRegistrationResult[]> {
    const results: MerchantRegistrationResult[] = [];

    for (const merchant of merchants) {
      const result = await this.registerMerchant(merchant);
      results.push(result);

      // Add delay between registrations to avoid nonce issues
      if (!this.isMockMode() && merchant !== merchants[merchants.length - 1]) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}

