import { Injectable } from "@nestjs/common";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  hexlify,
  parseUnits,
  randomBytes,
} from "ethers";
import { ApiException } from "../../../common/exceptions";
import {
  ConsentedPullAbi,
  DVPEscrowWithSettlementAbi,
  DvpEscrowContract,
  DvpContract,
} from "../../../contracts/types";

type TxSubmitResult = {
  transactionHash: string;
  chainId: number;
  contractAddress: string;
};

type ConsentedPullContract = Contract & {
  initiatePull: (
    intentId: string,
    payer: string,
    amount: bigint,
  ) => Promise<{ hash: string }>;
};

@Injectable()
export class BlockchainService {
  private provider: JsonRpcProvider | null = null;
  private signer: Wallet | null = null;

  private chainId: number = 11155111;

  constructor() {
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    if (rpcUrl) {
      this.provider = new JsonRpcProvider(rpcUrl);
    }

    const pk = process.env.PRIVATE_KEY;
    if (pk && this.provider) {
      try {
        this.signer = new Wallet(pk, this.provider);
      } catch {
        // Invalid / placeholder key: fall back to mock-mode.
        this.signer = null;
      }
    }
  }

  isMockMode(): boolean {
    return !this.provider || !this.signer;
  }

  getChainId(): number {
    return this.chainId;
  }

  /**
   * Create an order in the escrow contract (new escrow-based flow).
   * 
   * This replaces the old initiateDvP() method and uses the new order-based model.
   */
  async createOrder(params: {
    merchantId: bigint;
    orderId: bigint;
    buyer: string;
    token: string;
    amount: string;
    decimals: number;
    deliveryPeriod: number; // in seconds
    expectedDeliveryHash: string; // bytes32 hex string
    autoRelease: boolean;
    deliveryOracle: string; // address or zero address
    contractAddress: string;
  }): Promise<TxSubmitResult> {
    const { contractAddress } = params;
    if (
      !contractAddress ||
      contractAddress === "0x0000000000000000000000000000000000000000"
    ) {
      return this.mockTx("0x0000000000000000000000000000000000000000");
    }

    if (this.isMockMode()) {
      return this.mockTx(contractAddress);
    }

    try {
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer,
      ) as unknown as DvpEscrowContract;
      
      const tx = await contract.createOrder(
        params.merchantId,
        params.orderId,
        params.buyer,
        params.token,
        parseUnits(params.amount, params.decimals),
        params.deliveryPeriod,
        params.expectedDeliveryHash,
        params.autoRelease,
        params.deliveryOracle,
      );
      
      return {
        transactionHash: tx.hash,
        chainId: this.chainId,
        contractAddress,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new ApiException(
        "contract_execution_failed",
        `Failed to create order: ${message}`,
        500,
      );
    }
  }

  /**
   * Submit a DvP transaction (DEPRECATED - use createOrder instead).
   *
   * @deprecated This method is kept for backward compatibility but should not be used for new implementations.
   * Use createOrder() instead for the new escrow-based flow.
   */
  async submitDvP(params: {
    intentId: string;
    payerAddress: string;
    amount: string;
    decimals: number;
    contractAddress: string;
  }): Promise<TxSubmitResult> {
    const { contractAddress } = params;
    if (
      !contractAddress ||
      contractAddress === "0x0000000000000000000000000000000000000000"
    ) {
      return this.mockTx("0x0000000000000000000000000000000000000000");
    }

    if (this.isMockMode()) {
      return this.mockTx(contractAddress);
    }

    try {
      const payeeAddress = process.env.FINTERNET_SIGNER ?? this.signer!.address;
      const contract = new Contract(
        contractAddress,
        DVPEscrowWithSettlementAbi,
        this.signer,
      ) as unknown as DvpContract;
      const tx = await contract.initiateDvP(
        params.intentId,
        params.payerAddress,
        payeeAddress,
        parseUnits(params.amount, params.decimals),
      );
      return {
        transactionHash: tx.hash,
        chainId: this.chainId,
        contractAddress,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new ApiException(
        "contract_execution_failed",
        `Failed to execute DvP: ${message}`,
        500,
      );
    }
  }

  async submitConsentedPull(params: {
    intentId: string;
    payerAddress: string;
    amount: string;
    decimals: number;
    contractAddress: string;
  }): Promise<TxSubmitResult> {
    const { contractAddress } = params;
    if (
      !contractAddress ||
      contractAddress === "0x0000000000000000000000000000000000000000"
    ) {
      return this.mockTx("0x0000000000000000000000000000000000000000");
    }

    if (this.isMockMode()) {
      return this.mockTx(contractAddress);
    }

    try {
      const contract = new Contract(
        contractAddress,
        ConsentedPullAbi,
        this.signer,
      ) as unknown as ConsentedPullContract;
      const tx = await contract.initiatePull(
        params.intentId,
        params.payerAddress,
        parseUnits(params.amount, params.decimals),
      );
      return {
        transactionHash: tx.hash,
        chainId: this.chainId,
        contractAddress,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new ApiException(
        "contract_execution_failed",
        `Failed to execute ConsentedPull: ${message}`,
        500,
      );
    }
  }

  async getConfirmations(txHash: string): Promise<number> {
    if (!this.provider) return 5; // mock: immediately confirmed

    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) return 0;

    const latest = await this.provider.getBlockNumber();
    const confirmations = latest - receipt.blockNumber + 1;
    return confirmations < 0 ? 0 : confirmations;
  }

  private mockTx(contractAddress: string): TxSubmitResult {
    return {
      transactionHash: hexlify(randomBytes(32)),
      chainId: this.chainId,
      contractAddress,
    };
  }
}
