/**
 * Merchant Registration Utility
 * 
 * Standalone utility functions for merchant registration that can be used
 * outside of NestJS (e.g., in seed scripts).
 * 
 * Note: For production use, prefer MerchantRegistrationService which
 * integrates with NestJS dependency injection.
 */

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  Signature,
  isAddress,
  ContractTransactionResponse,
} from "ethers";
import { buildMerchantInitTypedData } from "../../../schema/merchant-init.schema";
import { DVPEscrowWithSettlementAbi, DvpEscrowContract } from "../../../contracts/types";

export interface MerchantRegistrationConfig {
  contractAddress: string;
  privateKey: string;
  rpcUrl: string;
  chainId?: number;
}

export interface MerchantRegistrationParams {
  merchantId: bigint | string | number;
  merchantAddress: string;
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

/**
 * Register a merchant on-chain (standalone utility)
 * 
 * @param config - Blockchain configuration
 * @param params - Merchant registration parameters
 * @returns Registration result
 */
export async function registerMerchantOnChain(
  config: MerchantRegistrationConfig,
  params: MerchantRegistrationParams,
): Promise<MerchantRegistrationResult> {
  const { contractAddress, privateKey, rpcUrl, chainId: configChainId } = config;
  const { merchantId, merchantAddress } = params;

  try {
    // Validate addresses
    if (!isAddress(merchantAddress)) {
      throw new Error(`Invalid merchant address: ${merchantAddress}`);
    }

    if (!isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }

    // Initialize provider and signer
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);

    // Get chain ID
    let chainId = configChainId;
    if (!chainId) {
      const network = await provider.getNetwork();
      chainId = Number(network.chainId);
    }

    // Get contract instance
    const contract = new Contract(
      contractAddress,
      DVPEscrowWithSettlementAbi,
      wallet,
    ) as unknown as DvpEscrowContract;

    // Check if merchant already exists and get nonce
    let nonce: bigint;
    try {
      const existingMerchant = await contract.merchants(
        BigInt(merchantId.toString()),
      );
      if (existingMerchant.isActive) {
        return {
          success: true,
          merchantId,
          merchantAddress,
          transactionHash: "already_registered",
        };
      }
      // Merchant exists but is inactive - still need to get current nonce
      nonce = await contract.merchantNonce(BigInt(merchantId.toString()));
    } catch (error) {
      // Merchant doesn't exist, get nonce (should be 0 for new merchants)
      nonce = await contract.merchantNonce(BigInt(merchantId.toString()));
    }

    // Set signature deadline (5 minutes from now)
    const signatureDeadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    // Build EIP-712 typed data
    const typedData = buildMerchantInitTypedData({
      merchantId: BigInt(merchantId.toString()),
      merchantAddress,
      nonce,
      signatureDeadline,
      chainId,
      verifyingContract: contractAddress,
    });

    // Sign with private key
    const { EIP712Domain, ...primaryTypes } = typedData.types;

    const signature = await wallet.signTypedData(
      typedData.domain as never,
      primaryTypes as never,
      typedData.message as never,
    );

    // Split signature into v, r, s components
    const sig = Signature.from(signature);

    // Call initializeMerchant on contract
    // Note: Type definition says it returns { hash: string }, but ethers actually returns ContractTransactionResponse
    const tx = (await contract.initializeMerchant(
      BigInt(merchantId.toString()),
      merchantAddress,
      signatureDeadline,
      sig.v,
      sig.r,
      sig.s,
    )) as unknown as ContractTransactionResponse;
    
    // Set gas limit separately if needed (ethers v6 handles this automatically)

    // Wait for transaction confirmation
    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error("Transaction receipt not received");
    }

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

    return {
      success: false,
      merchantId,
      merchantAddress,
      error: errorMessage,
    };
  }
}

/**
 * Get merchant details from on-chain contract (standalone utility)
 */
export async function getMerchantOnChain(
  contractAddress: string,
  rpcUrl: string,
  merchantId: bigint | string | number,
): Promise<{
  merchantAddress: string;
  isActive: boolean;
  isKybVerified: boolean;
  totalOrders: bigint;
  successfulDeliveries: bigint;
  disputes: bigint;
} | null> {
  try {
    if (!isAddress(contractAddress)) {
      throw new Error(`Invalid contract address: ${contractAddress}`);
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const contract = new Contract(
      contractAddress,
      DVPEscrowWithSettlementAbi,
      provider,
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
    return null;
  }
}

