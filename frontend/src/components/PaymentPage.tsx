import { useEffect, useState } from 'react';
import { parseUnits, isAddress } from 'ethers';
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { apiClient, PaymentIntentEntity } from '../services/api.client';
import './PaymentPage.css';

// Contract ABIs (simplified - you'd import from your contract artifacts)
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const DVP_ABI = [
  {
    name: 'initiateDvP',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'intentId', type: 'string' },
      { name: 'payer', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

const CONSENTED_PULL_ABI = [
  {
    name: 'initiatePull',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'intentId', type: 'string' },
      { name: 'payer', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

type PaymentStep = 'loading' | 'connect' | 'approve' | 'execute' | 'success' | 'error';

export default function PaymentPage() {
  const [intentId, setIntentId] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentEntity | null>(null);
  const [step, setStep] = useState<PaymentStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Wagmi hooks
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { writeContract, data: hash, isPending: isWriting, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  // Get intent ID from URL query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intent = params.get('intent');
    if (intent) {
      setIntentId(intent);
      loadPaymentIntent(intent);
    } else {
      setError('Missing payment intent ID. Please use the payment URL provided by the merchant.');
      setStep('error');
    }
  }, []);

  // Update step when wallet connects
  useEffect(() => {
    if (isConnected && address && paymentIntent) {
      if (paymentIntent.status === 'SUCCEEDED' || paymentIntent.status === 'SETTLED') {
        setStep('success');
      } else {
        setStep('execute'); // Skip approve step for now, can add later if needed
      }
    } else if (!isConnected && paymentIntent) {
      setStep('connect');
    }
  }, [isConnected, address, paymentIntent]);

  // Handle transaction success
  useEffect(() => {
    if (isConfirmed && hash) {
      setStep('success');
      // Poll for payment intent status update
      setTimeout(() => {
        if (intentId) {
          loadPaymentIntent(intentId);
        }
      }, 3000);
    }
  }, [isConfirmed, hash, intentId]);

  // Handle transaction errors
  useEffect(() => {
    if (writeError) {
      setError(writeError.message || 'Transaction failed');
      setStep('error');
    }
  }, [writeError]);

  const loadPaymentIntent = async (id: string) => {
    try {
      setLoading(true);
      const intent = await apiClient.getPaymentIntent(id);
      if (!intent) {
        throw new Error('Payment intent not found');
      }
      setPaymentIntent(intent);
      
      // Check if already completed
      if (intent.status === 'SUCCEEDED' || intent.status === 'SETTLED') {
        setStep('success');
      } else if (isConnected) {
        setStep('execute');
      } else {
        setStep('connect');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment intent');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!paymentIntent || !address || !paymentIntent.contractAddress || !walletClient) {
      return;
    }

    if (!isAddress(paymentIntent.contractAddress)) {
      setError('Invalid contract address');
      setStep('error');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const amount = parseUnits(paymentIntent.amount, 6); // Assuming 6 decimals for USDC
      const payeeAddress = import.meta.env.VITE_PAYEE_ADDRESS || address; // Fallback to connected address

      if (paymentIntent.type === 'DELIVERY_VS_PAYMENT') {
        writeContract({
          address: paymentIntent.contractAddress as `0x${string}`,
          abi: DVP_ABI,
          functionName: 'initiateDvP',
          args: [paymentIntent.id, address as `0x${string}`, payeeAddress as `0x${string}`, amount],
        });
      } else {
        writeContract({
          address: paymentIntent.contractAddress as `0x${string}`,
          abi: CONSENTED_PULL_ABI,
          functionName: 'initiatePull',
          args: [paymentIntent.id, address as `0x${string}`, amount],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !paymentIntent) {
    return (
      <div className="payment-page">
        <div className="payment-card">
          <h2>Loading Payment...</h2>
          <p>Please wait while we load your payment details.</p>
        </div>
      </div>
    );
  }

  if (!paymentIntent) {
    return (
      <div className="payment-page">
        <div className="payment-card error">
          <h2>Payment Not Found</h2>
          <p>{error || 'Unable to load payment intent. Please check the URL and try again.'}</p>
        </div>
      </div>
    );
  }

  const explorerUrl = hash ? `https://sepolia.etherscan.io/tx/${hash}` : '#';

  return (
    <div className="payment-page">
      <div className="payment-card">
        <h1>Complete Payment</h1>

        <div className="payment-details">
          <div className="detail-row">
            <span className="label">Amount:</span>
            <span className="value">{paymentIntent.amount} {paymentIntent.currency}</span>
          </div>
          {paymentIntent.description && (
            <div className="detail-row">
              <span className="label">Description:</span>
              <span className="value">{paymentIntent.description}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="label">Type:</span>
            <span className="value">{paymentIntent.type}</span>
          </div>
          <div className="detail-row">
            <span className="label">Status:</span>
            <span className={`value status-${paymentIntent.status.toLowerCase()}`}>
              {paymentIntent.status}
            </span>
          </div>
        </div>

        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}

        {step === 'connect' && (
          <div className="payment-actions">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <ConnectKitButton />
            </div>
            <p className="help-text">
              Connect your wallet to continue with the payment. You can use MetaMask, WalletConnect, or any supported wallet.
            </p>
          </div>
        )}

        {step === 'execute' && address && (
          <div className="payment-actions">
            <div className="wallet-info">
              <p>Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>
            </div>
            <button 
              onClick={handleExecute} 
              disabled={loading || isWriting || isConfirming} 
              className="btn-primary"
            >
              {isWriting || isConfirming ? 'Processing...' : `Execute Payment (${paymentIntent.type})`}
            </button>
            <p className="help-text">
              This will execute the payment transaction from your wallet. Please confirm in your wallet.
            </p>
          </div>
        )}

        {step === 'success' && (
          <div className="payment-success">
            <div className="success-icon">✓</div>
            <h2>Payment Successful!</h2>
            {hash && (
              <div className="tx-info">
                <p>Transaction Hash:</p>
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="tx-link">
                  {hash.slice(0, 10)}...{hash.slice(-8)}
                </a>
              </div>
            )}
            <p className="success-message">
              Your payment has been processed. The merchant will be notified.
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className="payment-actions">
            <button onClick={() => window.location.reload()} className="btn-primary">
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
