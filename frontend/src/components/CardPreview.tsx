import { useState } from 'react';
import './CardPreview.css';

export type CardType = 'visa' | 'mastercard' | 'amex' | 'unknown';

interface CardPreviewProps {
  cardNumber: string;
  cardholderName: string;
  expiry: string;
  cvv: string;
  focused?: 'number' | 'name' | 'expiry' | 'cvv' | null;
}

export function detectCardType(cardNumber: string): CardType {
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
}

export function CardPreview({ cardNumber, cardholderName, expiry, cvv, focused }: CardPreviewProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const cardType = detectCardType(cardNumber);
  const maskedCvv = cvv.replace(/./g, '•');

  // Auto-flip when CVV field is focused, otherwise respect manual flip state
  const showBack = focused === 'cvv' || isFlipped;

  const handleCardClick = () => {
    if (focused !== 'cvv') {
      setIsFlipped(!isFlipped);
    }
  };

  // Show card number as user types (masked when not focused)
  const maskCardNumber = (number: string) => {
    const digits = number.replace(/\s/g, '');
    if (digits.length === 0) {
      return cardType === 'amex' ? '•••• •••••• •••••' : '•••• •••• •••• ••••';
    }
    
    // Show actual digits when typing (number field focused)
    if (focused === 'number') {
      if (cardType === 'amex') {
        if (digits.length <= 4) {
          return digits + ' •••• ••••••';
        } else if (digits.length <= 10) {
          return digits.slice(0, 4) + ' ' + digits.slice(4) + ' ••••••';
        } else {
          return digits.slice(0, 4) + ' ' + digits.slice(4, 10) + ' ' + digits.slice(10);
        }
      } else {
        return digits.replace(/(.{4})/g, '$1 ').trim();
      }
    }
    
    // Mask when not focused on number field
    const visible = digits.slice(-4);
    const masked = '•'.repeat(Math.max(0, digits.length - 4));
    
    if (cardType === 'amex') {
      if (digits.length <= 4) {
        return digits + ' •••• ••••••';
      } else if (digits.length <= 10) {
        return digits.slice(0, 4) + ' •••••• •••••';
      } else {
        return digits.slice(0, 4) + ' •••••• ' + digits.slice(-5);
      }
    }
    
    const formatted = (masked + visible).replace(/(.{4})/g, '$1 ').trim();
    return formatted.padEnd(19, '•').replace(/(.{4})/g, '$1 ').trim();
  };

  const displayCardNumber = maskCardNumber(cardNumber);
  const displayName = cardholderName || 'CARDHOLDER NAME';
  const displayExpiry = expiry || 'MM/YY';
  const displayCvv = cvv ? maskedCvv : '•••';

  return (
    <div 
      className={`card-preview ${cardType} ${showBack ? 'flipped' : ''} ${focused ? `focused-${focused}` : ''}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      aria-label={showBack ? 'Flip card to front' : 'Flip card to back'}
    >
      <div className="card-inner">
        <div className="card-front">
          <div className="card-header">
            <div className="card-chip">
              <div className="chip-line"></div>
              <div className="chip-line"></div>
              <div className="chip-line"></div>
              <div className="chip-line"></div>
            </div>
            <div className="card-brand">
              {cardType === 'visa' && (
                <div className="card-logo visa">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Visa_Inc._logo.svg/2560px-Visa_Inc._logo.svg.png" alt="Visa" />
                </div>
              )}
              {cardType === 'mastercard' && (
                <div className="card-logo mastercard">
                  <div className="mc-circle mc-circle-1"></div>
                  <div className="mc-circle mc-circle-2"></div>
                </div>
              )}
              {cardType === 'amex' && (
                <div className="card-logo amex">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/American_Express_logo.svg/2560px-American_Express_logo.svg.png" alt="American Express" />
                </div>
              )}
              {cardType === 'unknown' && <div className="card-brand-placeholder"></div>}
            </div>
          </div>
          <div className="card-number">{displayCardNumber}</div>
          <div className="card-footer">
            <div className="card-name">{displayName}</div>
            <div className="card-expiry">{displayExpiry}</div>
          </div>
        </div>
        <div className="card-back">
          <div className="card-back-stripes"></div>
          <div className="card-magnetic-stripe"></div>
            <div className="card-back-content">
              <div className="card-back-row">
                <div className="card-signature-strip">
                  <div className="signature-label">AUTHORIZED SIGNATURE</div>
                  <div className="signature-box">
                    {cardholderName && <div className="signature-text">{cardholderName}</div>}
                  </div>
                </div>
                <div className="card-cvv-container">
                  <div className="card-cvv-label">CVV</div>
                  {/* Make sure CVV is not reversed when card is flipped */}
                  <div className="card-cvv">{displayCvv}</div>
                </div>
              </div>
            </div>
          <div className="card-brand-back">
            {cardType === 'visa' && (
              <div className="card-logo-back visa">
                  <img src="https://corporate.visa.com/content/dam/VCOM/corporate/about-visa/images/visa-brandmark-blue-1960x622.png" alt="Visa" />
              </div>
            )}
            {cardType === 'mastercard' && (
              <div className="card-logo-back mastercard">
                  <div className="mc-circle mc-circle-1"></div>
                  <div className="mc-circle-back mc-circle-2"></div>
              </div>
            )}
            {cardType === 'amex' && (
              <div className="card-logo-back amex">
                <div className="amex-text-back">AMEX</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
