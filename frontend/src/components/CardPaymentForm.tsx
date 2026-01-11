import { useState } from 'react';
import { CardPreview } from './CardPreview';
import './CardPaymentForm.css';

export interface CardDetails {
  cardNumber: string;
  expiry: string; // MM/YY
  cvv: string;
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

interface CardPaymentFormProps {
  onSubmit: (cardDetails: CardDetails) => void;
  loading: boolean;
  error?: string | null;
}

export function CardPaymentForm({ onSubmit, loading, error }: CardPaymentFormProps) {
  const [cardDetails, setCardDetails] = useState<CardDetails>({
    cardNumber: '',
    expiry: '',
    cvv: '',
    name: '',
  });
  const [focusedField, setFocusedField] = useState<'number' | 'name' | 'expiry' | 'cvv' | null>(null);

  const formatCardNumber = (value: string): string => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    
    // Detect card type for formatting
    const cardType = detectCardType(digits);
    
    // Amex uses 4-6-5 format
    if (cardType === 'amex') {
      if (digits.length <= 4) {
        return digits;
      } else if (digits.length <= 10) {
        return `${digits.slice(0, 4)} ${digits.slice(4)}`;
      } else {
        return `${digits.slice(0, 4)} ${digits.slice(4, 10)} ${digits.slice(10, 15)}`;
      }
    }
    
    // Visa/Mastercard use 4-4-4-4 format
    return digits.replace(/(.{4})/g, '$1 ').trim();
  };

  const formatExpiry = (value: string): string => {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 2) {
      return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
    }
    return digits;
  };

  const detectCardType = (cardNumber: string): 'visa' | 'mastercard' | 'amex' | 'unknown' => {
    const digits = cardNumber.replace(/\s/g, '');
    
    if (digits.length === 0) {
      return 'unknown';
    }

    // Visa: starts with 4
    if (/^4/.test(digits)) {
      return 'visa';
    }

    // Mastercard: starts with 51-55 or 2221-2720
    if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) {
      return 'mastercard';
    }

    // Amex: starts with 34 or 37
    if (/^3[47]/.test(digits)) {
      return 'amex';
    }

    return 'unknown';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(cardDetails);
  };

  // Get max length based on card type
  const cardType = detectCardType(cardDetails.cardNumber);
  const maxCardLength = cardType === 'amex' ? 17 : 19; // Amex: 15 digits + 2 spaces, Others: 16 digits + 3 spaces
  const maxCvvLength = cardType === 'amex' ? 4 : 3;

  return (
    <div className="card-form-container">
      <CardPreview
        cardNumber={cardDetails.cardNumber}
        cardholderName={cardDetails.name}
        expiry={cardDetails.expiry}
        cvv={cardDetails.cvv}
        focused={focusedField}
      />
      
      <form onSubmit={handleSubmit} className="card-form">
        <div className="form-group">
          <label htmlFor="cardNumber">Card Number</label>
          <input
            id="cardNumber"
            type="text"
            inputMode="numeric"
            placeholder={cardType === 'amex' ? '3782 822463 10005' : '1234 5678 9012 3456'}
            value={cardDetails.cardNumber}
            onChange={(e) =>
              setCardDetails({
                ...cardDetails,
                cardNumber: formatCardNumber(e.target.value),
              })
            }
            onFocus={() => setFocusedField('number')}
            onBlur={() => setFocusedField(null)}
            maxLength={maxCardLength}
            required
            disabled={loading}
            autoComplete="cc-number"
          />
        </div>

        <div className="form-group">
          <label htmlFor="name">Cardholder Name</label>
          <input
            id="name"
            type="text"
            placeholder="John Doe"
            value={cardDetails.name}
            onChange={(e) =>
              setCardDetails({ ...cardDetails, name: e.target.value })
            }
            onFocus={() => setFocusedField('name')}
            onBlur={() => setFocusedField(null)}
            required
            disabled={loading}
            autoComplete="cc-name"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="expiry">Expiry Date</label>
            <input
              id="expiry"
              type="text"
              inputMode="numeric"
              placeholder="MM / YY"
              value={cardDetails.expiry}
              onChange={(e) =>
                setCardDetails({
                  ...cardDetails,
                  expiry: formatExpiry(e.target.value),
                })
              }
              onFocus={() => setFocusedField('expiry')}
              onBlur={() => setFocusedField(null)}
              maxLength={5}
              required
              disabled={loading}
              autoComplete="cc-exp"
            />
          </div>

          <div className="form-group">
            <label htmlFor="cvv">CVV</label>
            <input
              id="cvv"
              type="text"
              inputMode="numeric"
              placeholder={cardType === 'amex' ? '1234' : '123'}
              value={cardDetails.cvv}
              onChange={(e) =>
                setCardDetails({
                  ...cardDetails,
                  cvv: e.target.value.replace(/\D/g, '').slice(0, maxCvvLength),
                })
              }
              onFocus={() => setFocusedField('cvv')}
              onBlur={() => setFocusedField(null)}
              maxLength={maxCvvLength}
              required
              disabled={loading}
              autoComplete="cc-csc"
            />
          </div>
        </div>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="submit-button">
          {loading ? (
            <>
              <span className="button-spinner"></span>
              Processing...
            </>
          ) : (
            'Pay Now'
          )}
        </button>
      </form>
    </div>
  );
}

