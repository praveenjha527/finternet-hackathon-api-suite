import { useEffect, useState, useMemo } from 'react';
import { parseUnits, isAddress } from 'ethers';
import { useAccount, useWalletClient, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSignTypedData } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import toast from 'react-hot-toast';
import { apiClient, PaymentIntentEntity } from '../services/api.client';
import './PaymentPage.css';

// USDC address on Sepolia (you can move this to env vars)
const USDC_SEPOLIA = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';

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
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
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

type PaymentStep = 'loading' | 'connect' | 'sign' | 'approve' | 'execute' | 'processing' | 'success' | 'error';

export default function PaymentPage() {
  const [intentId, setIntentId] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentEntity | null>(null);
  const [step, setStep] = useState<PaymentStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [eip712Signature, setEip712Signature] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

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
  // Use consistent token address - prefer VITE_USDC_ADDRESS, fallback to VITE_TOKEN_ADDRESS, then default
  const tokenAddress = import.meta.env.VITE_USDC_ADDRESS || import.meta.env.VITE_TOKEN_ADDRESS || USDC_SEPOLIA;
  const contractAddress = paymentIntent?.contractAddress;
  const amountInWei = paymentIntent ? parseUnits(paymentIntent.amount, 6) : BigInt(0);
  
  // USDC Edge Case: Check balance before allowing operations
  const { data: balance } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    query: {
      enabled: !!address && isAddress(tokenAddress),
    },
  });

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
  const hasInsufficientBalance = balance !== undefined && balance < amountInWei;

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
      } else if (hasInsufficientBalance) {
        // Edge case: User doesn't have enough USDC balance
        setError(`Insufficient USDC balance. You have ${balance ? (Number(balance) / 1e6).toFixed(2) : '0'} USDC, but need ${paymentIntent.amount} USDC.`);
        setStep('error');
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
  }, [isConnected, address, paymentIntent, eip712Signature, needsApproval, hasInsufficientBalance, balance]);

  // Handle approval confirmation
  useEffect(() => {
    if (isApprovalConfirmed && step === 'approve') {
      toast.success('Token approval confirmed!');
      // Wait for blockchain state to update and verify allowance
      const verifyAndProceed = async () => {
        let attempts = 0;
        const maxAttempts = 10;
        const delay = 1000; // 1 second between attempts
        
        while (attempts < maxAttempts) {
          try {
            const result = await refetchAllowance();
            const updatedAllowance = result.data as bigint | undefined;
            const requiredAmount = paymentIntent ? parseUnits(paymentIntent.amount, 6) : BigInt(0);
            
            console.log(`Allowance check attempt ${attempts + 1}:`, {
              allowance: updatedAllowance?.toString(),
              required: requiredAmount.toString(),
              sufficient: updatedAllowance !== undefined && updatedAllowance >= requiredAmount,
            });
            
            if (updatedAllowance !== undefined && updatedAllowance >= requiredAmount) {
              console.log('✅ Allowance confirmed, proceeding to execute step');
              setStep('execute');
              return;
            }
            
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (err) {
            console.error(`Allowance check attempt ${attempts + 1} failed:`, err);
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        // If we've exhausted retries, still move to execute step
        // The transaction was confirmed, so the allowance should be there
        console.warn('⚠️ Allowance verification timed out after', maxAttempts, 'attempts, proceeding anyway');
        toast('Approval confirmed, but allowance verification timed out. Proceeding...', { icon: '⚠️' });
        setStep('execute');
      };
      
      verifyAndProceed();
    }
  }, [isApprovalConfirmed, step, refetchAllowance, paymentIntent]);

  // Handle execution confirmation
  useEffect(() => {
    if (isExecutionConfirmed && executeHash && intentId) {
      console.log('Transaction confirmed, updating backend with transaction hash:', executeHash);
      
      // Update backend with transaction hash
      apiClient.updateTransactionHash(intentId, executeHash)
        .then((updatedIntent) => {
          console.log('Backend updated with transaction hash, payment intent:', updatedIntent);
          setPaymentIntent(updatedIntent);
          
          // Show message that transaction is processed
          toast.success('Transaction processed successfully!');
          setStep('processing'); // Move to processing step to show the message
          
          // Start polling for payment intent status until it's SUCCEEDED or SETTLED
          setIsPolling(true);
          let pollCount = 0;
          const maxPolls = 60; // Poll for up to 2 minutes (60 * 2 seconds)
          
          const pollInterval = setInterval(async () => {
            try {
              pollCount++;
              const currentIntent = await apiClient.getPaymentIntent(intentId);
              setPaymentIntent(currentIntent);
              
              console.log(`Polling payment intent status (${pollCount}/${maxPolls}):`, currentIntent.status);
              
              if (currentIntent.status === 'SUCCEEDED' || currentIntent.status === 'SETTLED') {
                clearInterval(pollInterval);
                setIsPolling(false);
                setStep('success');
                toast.success('Payment completed successfully!');
              } else if (currentIntent.status === 'CANCELED' || currentIntent.status === 'REQUIRES_ACTION') {
                clearInterval(pollInterval);
                setIsPolling(false);
                setStep('error');
                setError('Payment failed or was canceled');
              } else if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                setIsPolling(false);
                console.warn('Polling timeout - payment intent status:', currentIntent.status);
                toast('Payment is still processing. Please check back later.', { icon: '⚠️' });
                setStep('success'); // Show success anyway since transaction was confirmed
              }
            } catch (err) {
              console.error('Error polling payment intent:', err);
              // Continue polling on error, but stop after max attempts
              if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                setIsPolling(false);
              }
            }
          }, 2000); // Poll every 2 seconds
        })
        .catch((err) => {
          console.error('Failed to update transaction hash:', err);
          toast.error('Failed to update payment status. Please check the transaction manually.');
          // Still show success since the transaction was confirmed on-chain
          setStep('success');
        });
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
        // USDC Edge Case 6: Better error messages for approval failures
        const errorMessage = approvalError.message || 'Approval failed';
        let userFriendlyMessage = errorMessage;
        
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
          userFriendlyMessage = 'Insufficient USDC balance for gas fees. Please add more ETH for gas.';
        } else if (errorMessage.includes('blacklist') || errorMessage.includes('frozen')) {
          userFriendlyMessage = 'USDC account is restricted. Please contact USDC support.';
        } else if (errorMessage.includes('paused')) {
          userFriendlyMessage = 'USDC transfers are currently paused. Please try again later.';
        } else if (errorMessage.includes('revert') || errorMessage.includes('execution reverted')) {
          userFriendlyMessage = 'Approval failed. The USDC contract may have restrictions. Please try again or contact support.';
        }
        
        toast.error(userFriendlyMessage);
        setError(userFriendlyMessage);
        setStep('error');
      }
    }
  }, [approvalError]);

  useEffect(() => {
    if (executeError) {
      if (isUserRejection(executeError)) {
        toast.error('Transaction cancelled. Please confirm the payment transaction to complete.');
      } else {
        // USDC Edge Case 3: Better error messages for USDC-specific errors
        const errorMessage = executeError.message || 'Transaction failed';
        let userFriendlyMessage = errorMessage;
        
        if (errorMessage.includes('TRANSFER_FROM_FAILED')) {
          userFriendlyMessage = 'Token transfer failed. Please ensure you have approved the contract to spend your USDC and have sufficient balance.';
        } else if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
          userFriendlyMessage = 'Insufficient USDC balance. Please add more USDC to your wallet.';
        } else if (errorMessage.includes('allowance') || errorMessage.includes('approval')) {
          userFriendlyMessage = 'Token approval issue. Please try approving again.';
        } else if (errorMessage.includes('blacklist') || errorMessage.includes('frozen')) {
          userFriendlyMessage = 'USDC account is restricted. Please contact USDC support.';
        } else if (errorMessage.includes('paused')) {
          userFriendlyMessage = 'USDC transfers are currently paused. Please try again later.';
        }
        
        toast.error(userFriendlyMessage);
        setError(userFriendlyMessage);
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
      
      // USDC Edge Case: Check balance before approval
      if (balance !== undefined && balance < amountInWei) {
        const balanceFormatted = (Number(balance) / 1e6).toFixed(6);
        toast.error(`Insufficient USDC balance. You have ${balanceFormatted} USDC, but need ${paymentIntent.amount} USDC.`);
        setError(`Insufficient USDC balance. You have ${balanceFormatted} USDC, but need ${paymentIntent.amount} USDC.`);
        setStep('error');
        return;
      }

      const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // Max uint256
      // Use the same tokenAddress variable that's used for allowance check and execution
      // This ensures consistency across all operations
      
      console.log('Approving USDC token:', {
        tokenAddress: tokenAddress,
        spender: contractAddress,
        amount: maxApproval.toString(),
        userAddress: address,
        userBalance: balance?.toString(),
      });
      
      writeContractApproval({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [contractAddress as `0x${string}`, maxApproval],
        gas: BigInt(100000), // Set gas limit for approval
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
      
      // Use the same token address that was used for approval and allowance check
      // This ensures consistency across all operations
      const executionTokenAddress = tokenAddress; // Use the same tokenAddress from the hook
      
      console.log('Using token address for execution:', {
        tokenAddress: executionTokenAddress,
        contractAddress: contractAddress,
        userAddress: address,
      });

      // Double-check allowance before executing
      // This prevents TRANSFER_FROM_FAILED errors
      if (address && contractAddress) {
        // Use the same token address for allowance check (already set above)
        const checkTokenAddress = executionTokenAddress;
        
        // Check current allowance - if insufficient, refetch and verify
        if (allowance === undefined || allowance < amount) {
          console.log('Allowance check: Current allowance insufficient, refetching...');
          console.log('Allowance check details:', {
            userAddress: address,
            contractAddress: contractAddress,
            tokenAddress: checkTokenAddress,
            currentAllowance: allowance?.toString(),
            requiredAmount: amount.toString(),
          });
          
          const result = await refetchAllowance();
          const updatedAllowance = result.data as bigint | undefined;
          
          console.log('Allowance check after refetch:', {
            current: allowance?.toString(),
            updated: updatedAllowance?.toString(),
            required: amount.toString(),
            sufficient: updatedAllowance !== undefined && updatedAllowance >= amount,
          });
          
          if (updatedAllowance === undefined || updatedAllowance < amount) {
            toast.error(`Insufficient token approval. Required: ${amount.toString()}, Approved: ${updatedAllowance?.toString() || '0'}`);
            setStep('approve');
            return;
          }
        } else {
          console.log('Allowance check passed:', {
            allowance: allowance.toString(),
            required: amount.toString(),
          });
        }
      }

      if (paymentIntent.type === 'DELIVERY_VS_PAYMENT') {
        // Use new createOrder function for escrow-based payments
        const metadata = paymentIntent.metadata as Record<string, unknown> || {};
        
        // Get contractMerchantId from metadata (provided by backend)
        // Fallback to hash-based derivation if not available (for backward compatibility)
        const contractMerchantIdStr = (metadata.contractMerchantId as string);
        const merchantId = contractMerchantIdStr 
          ? BigInt(contractMerchantIdStr)
          : stringToUint256(paymentIntent.id);
        
        // Derive orderId from paymentIntent id (using hash-based approach)
        const orderId = stringToUint256(paymentIntent.id);
        
        // Get escrow parameters from metadata or use defaults
        const deliveryPeriod = (metadata.deliveryPeriod as number) || 2592000; // 30 days default
        const expectedDeliveryHash = (metadata.expectedDeliveryHash as string) || '0x0000000000000000000000000000000000000000000000000000000000000000';
        const autoRelease = (metadata.autoRelease as boolean) ?? true;
        const deliveryOracle = (metadata.deliveryOracle as string) || '0x0000000000000000000000000000000000000000';

        console.log('Executing createOrder with params:', {
          merchantId: merchantId.toString(),
          orderId: orderId.toString(),
          buyer: address,
          token: executionTokenAddress,
          amount: amount.toString(),
          contract: contractAddress,
        });

        writeContractExecute({
          address: contractAddress as `0x${string}`,
          abi: DVP_ABI,
          functionName: 'createOrder',
          args: [
            merchantId,
            orderId,
            address as `0x${string}`,
            executionTokenAddress as `0x${string}`,
            amount,
            deliveryPeriod,
            expectedDeliveryHash as `0x${string}`,
            autoRelease,
            deliveryOracle as `0x${string}`,
          ],
          gas: BigInt(500000), // Set gas limit for createOrder
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

        {/* Only show action buttons if payment intent status is INITIATED */}
        {paymentIntent.status === 'INITIATED' && step === 'connect' && (
          <div className="payment-actions">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <ConnectKitButton />
            </div>
            <p className="help-text">
              Connect your wallet to continue with the payment. You can use MetaMask, WalletConnect, or any supported wallet.
            </p>
          </div>
        )}

        {paymentIntent.status === 'INITIATED' && step === 'sign' && address && typedData && (
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

        {paymentIntent.status === 'INITIATED' && step === 'approve' && address && contractAddress && (
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

        {paymentIntent.status === 'INITIATED' && step === 'execute' && address && contractAddress && (
          <div className="payment-actions">
            <div className="wallet-info">
              <p>Connected: {address.slice(0, 6)}...{address.slice(-4)}</p>
            </div>
            
            {(isExecuting || isExecutionConfirming || isPolling) && (
              <div className="status-message status-confirming">
                <div className="status-spinner"></div>
                <div className="status-content">
                  <p className="status-title">
                    {isPolling 
                      ? 'Processing Payment' 
                      : isExecutionConfirming 
                      ? 'Transaction Confirming' 
                      : 'Executing Payment'}
                  </p>
                  <p className="status-description">
                    {isPolling
                      ? 'Waiting for payment to be processed and confirmed...'
                      : isExecutionConfirming 
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
              disabled={isExecuting || isExecutionConfirming || isPolling} 
              className="btn-primary"
            >
              {isPolling
                ? 'Processing...'
                : isExecuting 
                ? 'Executing...' 
                : isExecutionConfirming 
                ? 'Confirming...' 
                : `Execute Payment (${paymentIntent.type})`}
            </button>
            {!isExecuting && !isExecutionConfirming && !isPolling && (
              <p className="help-text">
                Execute the payment transaction. This will transfer the tokens to complete the payment.
              </p>
            )}
          </div>
        )}

        {step === 'processing' && (
          <div className="payment-processing">
            <div className="status-message status-confirming">
              <div className="status-spinner"></div>
              <div className="status-content">
                <p className="status-title">Transaction Processed</p>
                <p className="status-description">
                  Your transaction has been submitted and is being processed. The payment status will update automatically.
                </p>
                {executeHash && (
                  <div className="tx-info" style={{ marginTop: '1rem' }}>
                    <p>Transaction Hash:</p>
                    <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="tx-link">
                      {executeHash.slice(0, 10)}...{executeHash.slice(-8)}
                    </a>
                  </div>
                )}
                {paymentIntent && (
                  <div style={{ marginTop: '1rem' }}>
                    <p className="status-description">
                      Current Status: <strong>{paymentIntent.status}</strong>
                    </p>
                  </div>
                )}
              </div>
            </div>
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
