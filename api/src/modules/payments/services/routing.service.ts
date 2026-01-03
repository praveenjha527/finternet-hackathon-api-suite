import { Injectable } from "@nestjs/common";
import { ApiException } from "../../../common/exceptions";

@Injectable()
export class RoutingService {
  private readonly allowedSettlementMethods = new Set<string>([
    "OFF_RAMP_TO_RTP",
    "OFF_RAMP_TO_BANK",
    "OFF_RAMP_MOCK",
  ]);

  validateSettlementMethod(settlementMethod: string) {
    if (!this.allowedSettlementMethods.has(settlementMethod)) {
      throw new ApiException(
        "invalid_settlement_method",
        `Unsupported settlementMethod: ${settlementMethod}`,
        400,
        "settlementMethod",
      );
    }
  }

  /**
   * Week-1 mock: return a static estimate for fee and delivery time.
   */
  getRouteEstimates() {
    return {
      estimatedFee: "2.50",
      estimatedDeliveryTime: "15s",
    };
  }
}
