import { Injectable } from '@nestjs/common';

@Injectable()
export class SettlementService {
  /**
   * Get the mock delay in milliseconds for OFF_RAMP_MOCK settlement.
   * Defaults to 10 seconds if not configured.
   */
  getMockDelayMs(): number {
    const raw = process.env.OFF_RAMP_MOCK_DELAY;
    const n = raw ? Number(raw) : 10_000;
    return Number.isFinite(n) ? n : 10_000;
  }

  /**
   * Process OFF_RAMP_MOCK settlement.
   * In a real implementation, this would execute the actual offramp (RTP, bank transfer, etc.).
   * For mock, we simulate the settlement to the merchant's settlement destination.
   *
   * @param settlementDestination - The destination where funds should be settled (e.g., bank account, RTP endpoint)
   * @param amount - The amount to settle
   * @param currency - The currency (e.g., USDC)
   * @returns Promise that resolves when settlement is complete (mock: immediate)
   */
  async processOffRampMock(
    settlementDestination: string,
    amount: string,
    currency: string,
  ): Promise<{ success: boolean; transactionId?: string }> {
    // Mock implementation: In production, this would:
    // 1. Call RTP API, bank transfer API, etc.
    // 2. Wait for confirmation
    // 3. Return transaction ID

    // For mock, we simulate successful settlement
    const mockTransactionId = `settlement_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Simulate settlement execution (async operation)
    await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay to simulate API call

    return {
      success: true,
      transactionId: mockTransactionId,
    };
  }
}


