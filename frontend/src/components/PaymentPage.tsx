import { useEffect, useState, useMemo } from 'react';
import { parseUnits, isAddress } from 'ethers';
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSignTypedData } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import toast from 'react-hot-toast';
import { apiClient, PaymentIntentEntity } from '../services/api.client';
import './PaymentPage.css';

// USDC address on Sepolia (you can move this to env vars)
const USDC_SEPOLIA = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';

// Contract ABIs
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
    name: 'createOrder',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merchantId', type: 'uint256' },
      { name: 'orderId', type: 'uint256' },
      { name: 'buyer', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deliveryPeriod', type: 'uint32' },
      { name: 'expectedDeliveryHash', type: 'bytes32' },
      { name: 'autoRelease', type: 'bool' },
      { name: 'deliveryOracle', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Legacy function (deprecated)
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

type PaymentStep = 'loading' | 'connect' | 'sign' | 'approve' | 'execute' | 'success' | 'error';

export default function PaymentPage() {
  const [intentId, setIntentId] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentEntity | null>(null);
  const [step, setStep] = useState<PaymentStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [eip712Signature, setEip712Signature] = useState<string | null>(null);

  // Wagmi hooks
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  
  // Contract execution hooks
  const { writeContract: writeContractApproval, data: approvalHash, isPending: isApproving, error: approvalError } = useWriteContract();
  const { writeContract: writeContractExecute, data: executeHash, isPending: isExecuting, error: executeError } = useWriteContract();
  
  // Transaction receipt hooks
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalConfirmed } = useWaitForTransactionReceipt({
    hash: approvalHash,
  });
  const { isLoading: isExecutionConfirming, isSuccess: isExecutionConfirmed } = useWaitForTransactionReceipt({
    hash: executeHash,
  });

  // EIP-712 signing
  const typedData = useMemo(() => {
    if (!paymentIntent?.typedData || !paymentIntent.contractAddress) return null;
    
    const data = paymentIntent.typedData as {
      domain: { name: string; version: string; chainId: number; verifyingContract: string };
      types: Record<string, Array<{ name: string; type: string }>>;
      message: { intentId: string; amount: string; nonce: number };
    };
    
    // Remove EIP712Domain from types (wagmi expects it separately)
    const { EIP712Domain, ...primaryTypes } = data.types;
    
    return {
      domain: data.domain,
      types: primaryTypes,
      message: data.message,
    };
  }, [paymentIntent]);

  const { signTypedDataAsync, isPending: isSigning, error: signError } = useSignTypedData();

  // Check token allowance
  const tokenAddress = import.meta.env.VITE_USDC_ADDRESS || USDC_SEPOLIA;
  const contractAddress = paymentIntent?.contractAddress;
  const amountInWei = paymentIntent ? parseUnits(paymentIntent.amount, 6) : BigInt(0);
  
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && contractAddress ? [address, contractAddress as `0x${string}`] : undefined,
    query: {
      enabled: !!address && !!contractAddress && isAddress(contractAddress),
    },
  });

  const needsApproval = allowance !== undefined && allowance < amountInWei;

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
      } else if (!eip712Signature) {
        setStep('sign');
      } else if (needsApproval) {
        setStep('approve');
      } else {
        setStep('execute');
      }
    } else if (!isConnected && paymentIntent) {
      setStep('connect');
    }
  }, [isConnected, address, paymentIntent, eip712Signature, needsApproval]);

  // Handle approval confirmation
  useEffect(() => {
    if (isApprovalConfirmed && step === 'approve') {
      toast.success('Token approval confirmed!');
      // Refetch allowance to ensure it's updated, then move to execute step
      refetchAllowance().then(() => {
        // Small delay to ensure state updates propagate
        setTimeout(() => {
          setStep('execute');
        }, 500);
      }).catch((err) => {
        console.error('Failed to refetch allowance:', err);
        // Still move to execute step - the transaction is confirmed
        setStep('execute');
      });
    }
  }, [isApprovalConfirmed, step, refetchAllowance]);

  // Handle execution confirmation
  useEffect(() => {
    if (isExecutionConfirmed && executeHash) {
      toast.success('Payment transaction confirmed!');
      setStep('success');
      // Poll for payment intent status update
      setTimeout(() => {
        if (intentId) {
          loadPaymentIntent(intentId);
        }
      }, 3000);
    }
  }, [isExecutionConfirmed, executeHash, intentId]);

  // Helper function to check if error is user rejection
  const isUserRejection = (error: unknown): boolean => {
    if (!error) return false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any)?.code || (error as any)?.cause?.code;
    
    // MetaMask rejection codes: 4001, 4902
    // Common rejection messages
    return (
      errorCode === 4001 ||
      errorCode === 4902 ||
      errorMessage.toLowerCase().includes('user rejected') ||
      errorMessage.toLowerCase().includes('user denied') ||
      errorMessage.toLowerCase().includes('user cancelled') ||
      errorMessage.toLowerCase().includes('rejected') ||
      errorMessage.toLowerCase().includes('denied transaction')
    );
  };

  // Handle errors with toast notifications
  useEffect(() => {
    if (signError) {
      if (isUserRejection(signError)) {
        toast.error('Signing cancelled. Please sign the payment intent to continue.');
      } else {
        toast.error(signError.message || 'Signing failed');
        setError(signError.message || 'Signing failed');
        setStep('error');
      }
    }
  }, [signError]);

  useEffect(() => {
    if (approvalError) {
      if (isUserRejection(approvalError)) {
        toast.error('Approval cancelled. Please approve token spending to continue.');
      } else {
        toast.error(approvalError.message || 'Approval failed');
        setError(approvalError.message || 'Approval failed');
        setStep('error');
      }
    }
  }, [approvalError]);

  useEffect(() => {
    if (executeError) {
      if (isUserRejection(executeError)) {
        toast.error('Transaction cancelled. Please confirm the payment transaction to complete.');
      } else {
        toast.error(executeError.message || 'Transaction failed');
        setError(executeError.message || 'Transaction failed');
        setStep('error');
      }
    }
  }, [executeError]);

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
        if (!eip712Signature) {
          setStep('sign');
        } else if (needsApproval) {
          setStep('approve');
        } else {
          setStep('execute');
        }
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

  const handleSign = async () => {
    if (!typedData) {
      toast.error('Typed data not available');
      setError('Typed data not available');
      return;
    }
    
    try {
      setError(null);
      const signature = await signTypedDataAsync({
        domain: typedData.domain,
        types: typedData.types,
        message: typedData.message,
        primaryType: 'PaymentIntent',
      } as any);
      setEip712Signature(signature);
      toast.success('Payment intent signed successfully');
      // After signing, move to approve step
      setStep('approve');
    } catch (err) {
      // Error handling is done in the useEffect for signError
      // Don't set error state here to avoid duplicate toast
      if (!isUserRejection(err)) {
        setError(err instanceof Error ? err.message : 'Failed to sign');
        setStep('error');
      }
    }
  };

  const handleApprove = async () => {
    if (!paymentIntent || !address || !contractAddress || !isAddress(contractAddress)) {
      return;
    }

    try {
      setError(null);
      const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // Max uint256
      
      writeContractApproval({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [contractAddress as `0x${string}`, maxApproval],
      });
    } catch (err) {
      // Error handling is done in the useEffect for approvalError
      // Don't set error state here to avoid duplicate toast
      if (!isUserRejection(err)) {
        setError(err instanceof Error ? err.message : 'Approval failed');
        setStep('error');
      }
    }
  };

  // Helper function to convert string to uint256 (bigint)
  const stringToUint256 = (str: string): bigint => {
    // Simple hash-based conversion for deterministic orderId
    const hash = BigInt('0x' + str.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').slice(0, 64));
    return hash;
  };

  const handleExecute = async () => {
    if (!paymentIntent || !address || !contractAddress || !walletClient) {
      return;
    }

    if (!isAddress(contractAddress)) {
      toast.error('Invalid contract address');
      setError('Invalid contract address');
      setStep('error');
      return;
    }

    try {
      setError(null);
      const amount = parseUnits(paymentIntent.amount, 6);
      const tokenAddress = import.meta.env.VITE_TOKEN_ADDRESS || USDC_SEPOLIA;

      if (paymentIntent.type === 'DELIVERY_VS_PAYMENT') {
        // Use new createOrder function for escrow-based payments
        const metadata = paymentIntent.metadata as Record<string, unknown> || {};
        
        // Derive merchantId and orderId from paymentIntent
        // In production, these should come from the API response
        // For now, use a default merchantId derived from metadata or paymentIntent id
        const merchantIdStr = (metadata.merchantId as string) || paymentIntent.id;
        const merchantId = stringToUint256(merchantIdStr);
        const orderId = stringToUint256(paymentIntent.id);
        
        // Get escrow parameters from metadata or use defaults
        const deliveryPeriod = (metadata.deliveryPeriod as number) || 2592000; // 30 days default
        const expectedDeliveryHash = (metadata.expectedDeliveryHash as string) || '0x0000000000000000000000000000000000000000000000000000000000000000';
        const autoRelease = (metadata.autoRelease as boolean) ?? true;
        const deliveryOracle = (metadata.deliveryOracle as string) || '0x0000000000000000000000000000000000000000';

        writeContractExecute({
          address: contractAddress as `0x${string}`,
          abi: DVP_ABI,
          functionName: 'createOrder',
          args: [
            merchantId,
            orderId,
            address as `0x${string}`,
            tokenAddress as `0x${string}`,
            amount,
            deliveryPeriod,
            expectedDeliveryHash as `0x${string}`,
            autoRelease,
            deliveryOracle as `0x${string}`,
          ],
        });
      } else {
        // Consented pull still uses the old method
        writeContractExecute({
          address: contractAddress as `0x${string}`,
          abi: CONSENTED_PULL_ABI,
          functionName: 'initiatePull',
          args: [paymentIntent.id, address as `0x${string}`, amount],
        });
      }
    } catch (err) {
      // Error handling is done in the useEffect for executeError
      // Don't set error state here to avoid duplicate toast
      if (!isUserRejection(err)) {
        setError(err instanceof Error ? err.message : 'Transaction failed');
        setStep('error');
      }
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

  const explorerUrl = (executeHash || approvalHash) ? `https://sepolia.etherscan.io/tx/${executeHash || approvalHash}` : '#';

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

        {step === 'sign' && address && typedData && (
          <div className="payment-actions">
            <div className="wallet-info">
              <p>Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>
            </div>
            
            {isSigning && (
              <div className="status-message status-signing">
                <div className="status-spinner"></div>
                <div className="status-content">
                  <p className="status-title">Signing Payment Intent</p>
                  <p className="status-description">Please review and sign the payment details in your wallet</p>
                </div>
              </div>
            )}

            <button 
              onClick={handleSign} 
              disabled={isSigning} 
              className="btn-primary"
            >
              {isSigning ? 'Signing...' : 'Sign Payment Intent'}
            </button>
            {!isSigning && (
              <p className="help-text">
                First, you'll sign the payment details. This creates a secure authorization for the payment.
              </p>
            )}
          </div>
        )}

        {step === 'approve' && address && contractAddress && (
          <div className="payment-actions">
            <div className="wallet-info">
              <p>Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>
            </div>
            
            {(isApproving || isApprovalConfirming) && (
              <div className="status-message status-signing">
                <div className="status-spinner"></div>
                <div className="status-content">
                  <p className="status-title">
                    {isApprovalConfirming ? 'Approval Confirming' : 'Waiting for Approval'}
                  </p>
                  <p className="status-description">
                    {isApprovalConfirming 
                      ? 'Waiting for blockchain confirmation...' 
                      : 'Please approve token spending in your wallet'}
                  </p>
                  {approvalHash && (
                    <a 
                      href={`https://sepolia.etherscan.io/tx/${approvalHash}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="tx-link-small"
                    >
                      View on Etherscan: {approvalHash.slice(0, 10)}...{approvalHash.slice(-8)}
                    </a>
                  )}
                </div>
              </div>
            )}

            <button 
              onClick={handleApprove} 
              disabled={isApproving || isApprovalConfirming} 
              className="btn-primary"
            >
              {isApproving 
                ? 'Approving...' 
                : isApprovalConfirming 
                ? 'Confirming...' 
                : 'Approve Token Spending'}
            </button>
            {!isApproving && !isApprovalConfirming && (
              <p className="help-text">
                Approve the contract to spend your tokens. This is a one-time operation per contract.
              </p>
            )}
          </div>
        )}

        {step === 'execute' && address && contractAddress && (
          <div className="payment-actions">
            <div className="wallet-info">
              <p>Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>
            </div>
            
            {(isExecuting || isExecutionConfirming) && (
              <div className="status-message status-confirming">
                <div className="status-spinner"></div>
                <div className="status-content">
                  <p className="status-title">
                    {isExecutionConfirming ? 'Transaction Confirming' : 'Executing Payment'}
                  </p>
                  <p className="status-description">
                    {isExecutionConfirming 
                      ? 'Waiting for blockchain confirmation...' 
                      : 'Please confirm the payment transaction in your wallet'}
                  </p>
                  {executeHash && (
                    <a 
                      href={`https://sepolia.etherscan.io/tx/${executeHash}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="tx-link-small"
                    >
                      View on Etherscan: {executeHash.slice(0, 10)}...{executeHash.slice(-8)}
                    </a>
                  )}
                </div>
              </div>
            )}

            <button 
              onClick={handleExecute} 
              disabled={isExecuting || isExecutionConfirming} 
              className="btn-primary"
            >
              {isExecuting 
                ? 'Executing...' 
                : isExecutionConfirming 
                ? 'Confirming...' 
                : `Execute Payment (${paymentIntent.type})`}
            </button>
            {!isExecuting && !isExecutionConfirming && (
              <p className="help-text">
                Execute the payment transaction. This will transfer the tokens to complete the payment.
              </p>
            )}
          </div>
        )}

        {step === 'success' && (
          <div className="payment-success">
            <div className="success-icon">✓</div>
            <h2>Payment Successful!</h2>
            {executeHash && (
              <div className="tx-info">
                <p>Transaction Hash:</p>
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="tx-link">
                  {executeHash.slice(0, 10)}...{executeHash.slice(-8)}
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
