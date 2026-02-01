import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";

export interface OnRampResult {
  success: boolean;
  transactionId: string;
  stablecoinAmount: string;
  stablecoinCurrency: string;
  fiatAmount: string;
  fiatCurrency: string;
  exchangeRate: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

function formatStablecoinAmount(value: bigint, decimals: number): string {
  const sign = value < 0n ? "-" : "";
  const absoluteValue = value < 0n ? -value : value;
  const factor = 10n ** BigInt(decimals);
  const whole = absoluteValue / factor;
  const fraction = absoluteValue % factor;
  const fractionString = fraction.toString().padStart(decimals, "0");
  return `${sign}${whole.toString()}.${fractionString}`;
}

/**
 * OnRampService
 * 
 * Mocked on-ramp service (fiat → stablecoins conversion).
 * For now, all conversions succeed immediately with 1:1 exchange rate.
 * In production, this would integrate with on-ramp providers like Coinbase, MoonPay, etc.
 */
@Injectable()
export class OnRampService {
  private readonly logger = new Logger(OnRampService.name);

  /**
   * Convert fiat currency to stablecoins (mocked implementation)
   * 
   * In production, this would:
   * 1. Create on-ramp order with provider (Coinbase, MoonPay, etc.)
   * 2. Execute fiat → crypto conversion
   * 3. Receive stablecoins in system wallet
   * 4. Return conversion result
   * 
   * @param fiatAmount - Amount in fiat currency
   * @param fiatCurrency - Fiat currency code (USD, EUR, etc.)
   * @param stablecoinCurrency - Target stablecoin (USDC, USDT, etc.)
   * @returns On-ramp result
   */
  async convertFiatToStablecoins(
    fiatAmount: string,
    fiatCurrency: string,
    stablecoinCurrency: string = "USDC",
  ): Promise<OnRampResult> {
    this.logger.log(
      `Converting ${fiatAmount} ${fiatCurrency} to ${stablecoinCurrency} (mocked)`,
    );

    // Mocked on-ramp processing - always succeeds for now
    // In production, this would integrate with on-ramp providers
    await this.simulateOnRampDelay();

    // Exchange rate defaults to 1:1 so small fiat amounts stay manageable.
    // Override via ONRAMP_EXCHANGE_RATE to simulate different ratios.
    const exchangeRateEnv = process.env.ONRAMP_EXCHANGE_RATE || "1";
    const exchangeRateValue = Number(exchangeRateEnv);
    const exchangeRateNumber =
      Number.isFinite(exchangeRateValue) && exchangeRateValue > 0
        ? exchangeRateValue
        : 1;
    const exchangeRate = exchangeRateNumber.toString();

    // Stablecoin amount is fiat amount divided by the exchange rate.
    const fiatAmountNumber = Number(fiatAmount);
    let stablecoinAmountValue = Number.isNaN(fiatAmountNumber)
      ? 0
      : fiatAmountNumber / exchangeRateNumber;

    const hackathonMode =
      process.env.ONRAMP_HACKATHON_MODE?.toLowerCase() === "true";
    if (hackathonMode) {
      stablecoinAmountValue = 0.0001;
    } else {
      const forcedStablecoinAmount =
        typeof process.env.ONRAMP_FIXED_USDC_AMOUNT === "string"
          ? Number(process.env.ONRAMP_FIXED_USDC_AMOUNT)
          : NaN;
      if (Number.isFinite(forcedStablecoinAmount) && forcedStablecoinAmount > 0) {
        stablecoinAmountValue = forcedStablecoinAmount;
      }
    }
    const USDC_DECIMALS = 6;
    const multiplier = 10 ** USDC_DECIMALS;
    const scaledStablecoinAmount =
      Number.isFinite(stablecoinAmountValue) && !Number.isNaN(stablecoinAmountValue)
        ? BigInt(Math.round(stablecoinAmountValue * multiplier))
        : 0n;
    const stablecoinAmount = formatStablecoinAmount(
      scaledStablecoinAmount,
      USDC_DECIMALS,
    );

    // Generate mock transaction ID (on-ramp provider format)
    const transactionId = `onramp_${uuidv4().replace(/-/g, "")}`;

    this.logger.log(
      `On-ramp completed: ${fiatAmount} ${fiatCurrency} → ${stablecoinAmount} ${stablecoinCurrency} @ ${exchangeRate}, txId: ${transactionId}`,
    );

    return {
      success: true,
      transactionId,
      stablecoinAmount,
      stablecoinCurrency,
      fiatAmount,
      fiatCurrency,
      exchangeRate,
      metadata: {
        provider: "mocked_onramp",
        processedAt: new Date().toISOString(),
        network: "sepolia", // Testnet for now
      },
    };
  }

  /**
   * Simulate on-ramp processing delay (mocked)
   */
  private async simulateOnRampDelay(): Promise<void> {
    // Simulate network delay (100-500ms)
    const delay = 100 + Math.random() * 400;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Get exchange rate (mocked)
   * 
   * In production, this would fetch real-time rates from on-ramp provider
   */
  async getExchangeRate(
    fiatCurrency: string,
    stablecoinCurrency: string,
  ): Promise<string> {
    // Mocked: 1:1 exchange rate
    // In production, fetch from provider API
    return "0.00001";
  }
}
