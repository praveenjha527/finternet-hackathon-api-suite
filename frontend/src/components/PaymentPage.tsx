import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient, PaymentIntentEntity } from '../services/api.client';
import { CardPaymentForm, CardDetails } from './CardPaymentForm';
import './PaymentPage.css';

type PaymentStep = 'loading' | 'form' | 'processing' | 'success' | 'error';

export default function PaymentPage() {
  const [intentId, setIntentId] = useState<string | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentEntity | null>(null);
  const [step, setStep] = useState<PaymentStep>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const loadPaymentIntent = async (id: string) => {
    try {
      setStep('loading');
      const intent = await apiClient.getPaymentIntent(id);
      setPaymentIntent(intent);
      
      // Only show payment form if status is INITIATED
      if (intent.status === 'INITIATED') {
        setStep('form');
      } else if (
        intent.status === 'PAYMENT_CONFIRMED' ||
        intent.status === 'PROCESSING' ||
        intent.status === 'SUCCEEDED' ||
        intent.status === 'SETTLED' ||
        intent.status === 'FINAL'
      ) {
        // Payment confirmed or above - frontend's work is done
        // User has successfully paid, backend handles the rest
        setStep('success');
      } else if (intent.status === 'CANCELED') {
        setError('This payment has been canceled.');
        setStep('error');
      } else if (intent.status === 'REQUIRES_ACTION') {
        setError('This payment requires additional action. Please contact the merchant.');
        setStep('error');
      } else {
        // For any other status, show error with status info
        setError(`Payment is in ${intent.status} state. Please contact support if you believe this is an error.`);
        setStep('error');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load payment intent';
      setError(errorMessage);
      setStep('error');
      toast.error(errorMessage);
    }
  };

  const handlePayment = async (cardDetails: CardDetails) => {
    if (!intentId) {
      toast.error('Payment intent ID is missing');
      return;
    }
    
    try {
      setIsProcessing(true);
      setStep('processing');
      setError(null);
      
      // Process payment via API
      const updatedIntent = await apiClient.processPayment(intentId, cardDetails);
      setPaymentIntent(updatedIntent);

      // Once payment is confirmed (PAYMENT_CONFIRMED or above), frontend's work is done
      // User has successfully paid, backend handles escrow/blockchain processing
      toast.success('Payment processed successfully!');
      setStep('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment processing failed';
      setError(errorMessage);
      setStep('form');
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatAmount = (amount: string, currency: string) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(parseFloat(amount));
    } catch {
      return `${amount} ${currency || 'USD'}`;
    }
  };

  return (
    <div className="payment-page">
      <div className="payment-container">
        <div className="payment-header">
          <h1>Complete Your Payment</h1>
          {paymentIntent && (
            <div className="payment-summary">
              <div className="summary-row">
                <span>Amount:</span>
                <span className="amount">{formatAmount(paymentIntent.amount, paymentIntent.currency)}</span>
          </div>
          {paymentIntent.description && (
                <div className="summary-row">
                  <span>Description:</span>
                  <span>{paymentIntent.description}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'loading' && (
          <div className="payment-content">
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading payment details...</p>
            </div>
          </div>
        )}

        {step === 'form' && paymentIntent && (
          <div className="payment-content">
            <CardPaymentForm
              onSubmit={handlePayment}
              loading={isProcessing}
              error={error}
            />
          </div>
        )}

        {step === 'processing' && (
          <div className="payment-content">
            <div className="processing-state">
              <div className="loading-spinner">
                <div className="spinner"></div>
              </div>
              <h2>Processing Payment...</h2>
              <p>Please wait while we process your payment. Do not close this page.</p>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="payment-content">
            <div className="success-state">
            <div className="success-icon">✓</div>
            <h2>Payment Successful!</h2>
              <p>Your payment has been processed successfully.</p>
              {paymentIntent && (
                <div className="payment-details">
                  <div className="detail-row">
                    <span>Payment ID:</span>
                    <span className="mono">{paymentIntent.id}</span>
                  </div>
                  <div className="detail-row">
                    <span>Amount:</span>
                    <span>{formatAmount(paymentIntent.amount, paymentIntent.currency)}</span>
                  </div>
                  <div className="detail-row">
                    <span>Status:</span>
                    <span className="status-badge success">{paymentIntent.status}</span>
                  </div>
              </div>
            )}
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="payment-content">
            <div className="error-state">
              <div className="error-icon">✕</div>
              <h2>Payment Error</h2>
              <p>{error || 'An error occurred while processing your payment.'}</p>
              {intentId && (
                <button
                  onClick={() => {
                    setError(null);
                    loadPaymentIntent(intentId);
                  }}
                  className="retry-button"
                >
                  Try Again
            </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
