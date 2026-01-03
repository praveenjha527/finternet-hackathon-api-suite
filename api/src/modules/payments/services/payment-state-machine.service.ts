import { Injectable } from "@nestjs/common";
import {
  PaymentIntentStatus,
  SettlementStatus,
} from "../entities/payment-intent.entity";
import { ApiException } from "../../../common/exceptions";

/**
 * State machine for Payment Intent status transitions.
 * Defines valid state transitions and enforces business rules.
 */
@Injectable()
export class PaymentStateMachineService {
  /**
   * Valid state transitions map
   * Key: current status, Value: array of valid next statuses
   */
  private readonly validTransitions: Map<
    PaymentIntentStatus,
    PaymentIntentStatus[]
  > = new Map([
    [
      PaymentIntentStatus.INITIATED,
      [
        PaymentIntentStatus.REQUIRES_SIGNATURE,
        PaymentIntentStatus.PROCESSING,
        PaymentIntentStatus.CANCELED,
      ],
    ],
    [
      PaymentIntentStatus.REQUIRES_SIGNATURE,
      [PaymentIntentStatus.PROCESSING, PaymentIntentStatus.CANCELED],
    ],
    [
      PaymentIntentStatus.PROCESSING,
      [
        PaymentIntentStatus.SUCCEEDED,
        PaymentIntentStatus.CANCELED,
        PaymentIntentStatus.REQUIRES_ACTION,
      ],
    ],
    [
      PaymentIntentStatus.SUCCEEDED,
      [PaymentIntentStatus.SETTLED, PaymentIntentStatus.REQUIRES_ACTION],
    ],
    [PaymentIntentStatus.SETTLED, [PaymentIntentStatus.FINAL]],
    [PaymentIntentStatus.CANCELED, []], // Terminal state
    [PaymentIntentStatus.FINAL, []], // Terminal state
    [
      PaymentIntentStatus.REQUIRES_ACTION,
      [PaymentIntentStatus.PROCESSING, PaymentIntentStatus.CANCELED],
    ],
  ]);

  /**
   * Check if a state transition is valid
   */
  canTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean {
    const allowedStates = this.validTransitions.get(from);
    if (!allowedStates) {
      return false;
    }
    return allowedStates.includes(to);
  }

  /**
   * Validate and transition state
   * Throws ApiException if transition is invalid
   */
  transition(
    currentStatus: PaymentIntentStatus,
    newStatus: PaymentIntentStatus,
    context?: { reason?: string },
  ): PaymentIntentStatus {
    if (currentStatus === newStatus) {
      return newStatus; // No-op if already in target state
    }

    if (!this.canTransition(currentStatus, newStatus)) {
      throw new ApiException(
        "invalid_state_transition",
        `Cannot transition from ${currentStatus} to ${newStatus}. ${context?.reason || ""}`,
        400,
      );
    }

    return newStatus;
  }

  /**
   * Get next valid states for a given status
   */
  getNextValidStates(
    currentStatus: PaymentIntentStatus,
  ): PaymentIntentStatus[] {
    return this.validTransitions.get(currentStatus) || [];
  }

  /**
   * Check if a status is terminal (no further transitions allowed)
   */
  isTerminalState(status: PaymentIntentStatus): boolean {
    const nextStates = this.validTransitions.get(status);
    return !nextStates || nextStates.length === 0;
  }

  /**
   * Determine next status based on current state and context
   */
  determineNextStatus(
    currentStatus: PaymentIntentStatus,
    context: {
      hasSignature?: boolean;
      hasTransactionHash?: boolean;
      hasConfirmations?: boolean;
      settlementStatus?: SettlementStatus;
    },
  ): PaymentIntentStatus | null {
    switch (currentStatus) {
      case PaymentIntentStatus.INITIATED:
        return PaymentIntentStatus.REQUIRES_SIGNATURE;

      case PaymentIntentStatus.REQUIRES_SIGNATURE:
        if (context.hasSignature) {
          return PaymentIntentStatus.PROCESSING;
        }
        return null;

      case PaymentIntentStatus.PROCESSING:
        if (context.hasTransactionHash && context.hasConfirmations) {
          return PaymentIntentStatus.SUCCEEDED;
        }
        return null;

      case PaymentIntentStatus.SUCCEEDED:
        if (context.settlementStatus === SettlementStatus.COMPLETED) {
          return PaymentIntentStatus.SETTLED;
        }
        if (context.settlementStatus === SettlementStatus.FAILED) {
          return PaymentIntentStatus.REQUIRES_ACTION;
        }
        return null;

      case PaymentIntentStatus.SETTLED:
        return PaymentIntentStatus.FINAL;

      default:
        return null;
    }
  }
}
