import { BrowserProvider, Contract, JsonRpcSigner } from 'ethers';

// Contract ABIs (simplified - you'd import from your contract artifacts)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const DVP_ABI = [
  'function initiateDvP(string memory intentId, address payer, address payee, uint256 amount) external',
];

const CONSENTED_PULL_ABI = [
  'function initiatePull(string memory intentId, address payer, uint256 amount) external',
];

export interface WalletService {
  connect(): Promise<string>;
  getSigner(): Promise<JsonRpcSigner>;
  approveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint,
  ): Promise<{ hash: string }>;
  initiateDvP(
    contractAddress: string,
    intentId: string,
    payerAddress: string,
    payeeAddress: string,
    amount: bigint,
  ): Promise<{ hash: string }>;
  initiateConsentedPull(
    contractAddress: string,
    intentId: string,
    payerAddress: string,
    amount: bigint,
  ): Promise<{ hash: string }>;
}

class MetaMaskWalletService implements WalletService {
  private provider: BrowserProvider | null = null;
  private signer: JsonRpcSigner | null = null;

  async connect(): Promise<string> {
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
    }

    this.provider = new BrowserProvider(window.ethereum);
    const accounts = await this.provider.send('eth_requestAccounts', []);
    
    if (accounts.length === 0) {
      throw new Error('No accounts found. Please connect your wallet.');
    }

    this.signer = await this.provider.getSigner();
    return accounts[0];
  }

  async getSigner(): Promise<JsonRpcSigner> {
    if (!this.signer) {
      await this.connect();
    }
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return this.signer;
  }

  async approveToken(
    tokenAddress: string,
    spenderAddress: string,
    amount: bigint,
  ): Promise<{ hash: string }> {
    const signer = await this.getSigner();
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
    const tx = await tokenContract.approve(spenderAddress, amount);
    return { hash: tx.hash };
  }

  async initiateDvP(
    contractAddress: string,
    intentId: string,
    payerAddress: string,
    payeeAddress: string,
    amount: bigint,
  ): Promise<{ hash: string }> {
    const signer = await this.getSigner();
    const contract = new Contract(contractAddress, DVP_ABI, signer);
    const tx = await contract.initiateDvP(intentId, payerAddress, payeeAddress, amount);
    return { hash: tx.hash };
  }

  async initiateConsentedPull(
    contractAddress: string,
    intentId: string,
    payerAddress: string,
    amount: bigint,
  ): Promise<{ hash: string }> {
    const signer = await this.getSigner();
    const contract = new Contract(contractAddress, CONSENTED_PULL_ABI, signer);
    const tx = await contract.initiatePull(intentId, payerAddress, amount);
    return { hash: tx.hash };
  }
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any;
  }
}

export const walletService = new MetaMaskWalletService();

