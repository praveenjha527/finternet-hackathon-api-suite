import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { CardDetailsDto } from "../dto/process-payment.dto";

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  status: "succeeded" | "failed" | "pending";
  amount: string;
  currency: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

/**
 * PaymentProcessorService
 * 
 * Mocked payment processor service (Stripe-like).
 * For now, all payments succeed immediately.
 * In production, this would integrate with Stripe, PayPal, or another payment processor.
 */
@Injectable()
export class PaymentProcessorService {
  private readonly logger = new Logger(PaymentProcessorService.name);

  /**
   * Process a payment with card details (mocked implementation)
   * 
   * In production, this would:
   * 1. Validate card details
   * 2. Create payment intent with payment processor (Stripe, etc.)
   * 3. Confirm payment
   * 4. Handle 3D Secure if needed
   * 5. Return payment result
   * 
   * @param intentId - Payment intent ID
   * @param amount - Payment amount
   * @param currency - Payment currency
   * @param cardDetails - Card payment details
   * @returns Payment result
   */
  async processPayment(
    intentId: string,
    amount: string,
    currency: string,
    cardDetails: CardDetailsDto,
  ): Promise<PaymentResult> {
    this.logger.log(
      `Processing mocked payment for intent ${intentId}: ${amount} ${currency}`,
    );

    // Mocked payment processing - always succeeds for now
    // In production, this would integrate with Stripe, PayPal, etc.
    await this.simulateProcessingDelay();

    // Generate mock transaction ID (Stripe-like format)
    const transactionId = `pm_${uuidv4().replace(/-/g, "")}`;

    this.logger.log(
      `Payment succeeded for intent ${intentId}, transaction ID: ${transactionId}`,
    );

    return {
      success: true,
      transactionId,
      status: "succeeded",
      amount,
      currency,
      metadata: {
        cardLast4: cardDetails.cardNumber.slice(-4),
        cardBrand: this.detectCardBrand(cardDetails.cardNumber),
        processor: "mocked_stripe",
        processedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Simulate payment processing delay (mocked)
   */
  private async simulateProcessingDelay(): Promise<void> {
    // Simulate network delay (50-200ms)
    const delay = 50 + Math.random() * 150;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Detect card brand from card number (simple implementation)
   */
  private detectCardBrand(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\s/g, "");

    if (cleaned.startsWith("4")) {
      return "visa";
    } else if (cleaned.startsWith("5") || cleaned.startsWith("2")) {
      return "mastercard";
    } else if (cleaned.startsWith("3")) {
      return "amex";
    } else if (cleaned.startsWith("6")) {
      return "discover";
    }

    return "unknown";
  }

  /**
   * Validate card details (basic validation)
   * 
   * In production, this would use a payment processor's validation
   * or a library like credit-card-validator
   */
  validateCardDetails(cardDetails: CardDetailsDto): { valid: boolean; error?: string } {
    // Basic Luhn algorithm check
    const cardNumber = cardDetails.cardNumber.replace(/\s/g, "");
    
    if (!this.isValidLuhn(cardNumber)) {
      return {
        valid: false,
        error: "Invalid card number",
      };
    }

    // Validate expiry format (MM/YY)
    const expiryParts = cardDetails.expiry.split("/");
    if (expiryParts.length !== 2) {
      return {
        valid: false,
        error: "Invalid expiry format",
      };
    }
    const [month, year] = expiryParts;
    const expMonth = parseInt(month!, 10);
    const expYear = parseInt(year!, 10) + 2000; // Convert YY to YYYY

    if (expMonth < 1 || expMonth > 12) {
      return {
        valid: false,
        error: "Invalid expiry month",
      };
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      return {
        valid: false,
        error: "Card expired",
      };
    }

    return { valid: true };
  }

  /**
   * Luhn algorithm for card number validation
   */
  private isValidLuhn(cardNumber: string): boolean {
    let sum = 0;
    let isEven = false;

    // Start from the rightmost digit
    for (let i = cardNumber.length - 1; i >= 0; i--) {
      const char = cardNumber[i];
      if (!char) continue;
      let digit = parseInt(char, 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }
}
