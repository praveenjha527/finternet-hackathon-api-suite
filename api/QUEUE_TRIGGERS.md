# Queue Trigger Flow

This document explains how each queue is triggered and when jobs are enqueued.

## 1. Transaction Confirmation Queue

**Triggered When:**
- Frontend posts transaction hash to `POST /payment-intents/public/:intentId/transaction-hash`
- Called from: `IntentService.updateTransactionHash()`

**Flow:**
```
Frontend executes contract → Posts transaction hash → IntentService.updateTransactionHash() 
→ transactionConfirmationQueue.enqueueConfirmationCheck()
→ TransactionConfirmationQueueProcessor.process()
→ Checks receipt status (pending/success/failed)
→ If success: handleTransactionSuccess() → Enqueues settlement if OFF_RAMP_MOCK
→ If failed: handleTransactionFailed()
```

**Key Methods:**
- `TransactionConfirmationQueueService.enqueueConfirmationCheck()` - Enqueues the job
- `TransactionConfirmationQueueProcessor.process()` - Processes the job
- Checks transaction receipt status (not confirmations)
- Retries up to 60 times if pending

---

## 2. Settlement Queue

**Triggered When:**
1. **After transaction confirmation** (for all payment types):
   - `TransactionConfirmationQueueProcessor.handleTransactionSuccess()`
   - Only if `settlementMethod === "OFF_RAMP_MOCK"`

2. **After on-chain settlement execution** (for escrow payments):
   - `ProgrammablePaymentQueueProcessor` (time-lock, delivery proof, milestone)
   - After `executeSettlement()` succeeds on-chain

**Flow:**
```
Transaction confirmed → SettlementQueue.enqueueSettlement()
→ SettlementQueueProcessor.process()
→ For DELIVERY_VS_PAYMENT: Check contract state → Execute executeSettlement() on-chain
→ Process off-ramp mock (fiat settlement)
→ If off-ramp succeeds: confirmSettlement() on-chain
→ Update payment intent to SETTLED
```

**Key Methods:**
- `SettlementQueueService.enqueueSettlement()` - Enqueues the job
- `SettlementQueueProcessor.process()` - Processes the job
- For escrow: Executes `executeSettlement()` on-chain first
- Then processes off-ramp (mock fiat)
- Finally confirms with `confirmSettlement()` on-chain

---

## 3. Programmable Payment Queue

### 3.1 Time-Locked Release

**Triggered When:**
- Escrow order is created with `releaseType === "TIME_LOCKED"`
- Called from: `EscrowOrderService.scheduleReleaseJobs()`
- Scheduled when: `EscrowOrderService.createEscrowOrder()` is called

**Flow:**
```
EscrowOrderService.createEscrowOrder() 
→ scheduleReleaseJobs() 
→ programmablePaymentQueue.scheduleTimeLockRelease()
→ Job scheduled with delay until timeLockUntil timestamp
→ ProgrammablePaymentQueueProcessor.processTimeLockRelease()
→ Check if time lock expired
→ Execute executeSettlement() on-chain
→ Enqueue settlement job for off-ramp
```

**Key Methods:**
- `ProgrammablePaymentQueueService.scheduleTimeLockRelease()` - Schedules job with delay
- `ProgrammablePaymentQueueProcessor.processTimeLockRelease()` - Processes when time expires

---

### 3.2 Delivery Proof Processing

**Triggered When:**
- Delivery proof is submitted via API
- Called from: `EscrowOrderService.submitDeliveryProof()`
- API endpoint: `POST /payment-intents/:intentId/delivery-proof`

**Flow:**
```
API: POST /payment-intents/:intentId/delivery-proof
→ EscrowOrderService.submitDeliveryProof()
→ Creates DeliveryProof record
→ programmablePaymentQueue.scheduleDeliveryProofProcess()
→ ProgrammablePaymentQueueProcessor.processDeliveryProof()
→ If autoReleaseOnProof: Execute executeSettlement() on-chain
→ Enqueue settlement job for off-ramp
```

**Key Methods:**
- `EscrowOrderService.submitDeliveryProof()` - Creates proof and schedules job
- `ProgrammablePaymentQueueService.scheduleDeliveryProofProcess()` - Schedules job
- `ProgrammablePaymentQueueProcessor.processDeliveryProof()` - Processes proof

---

### 3.3 Milestone Check

**Triggered When:**
- Milestone is marked as completed
- Called from: `EscrowOrderService.completeMilestone()` (or similar)
- Note: Milestone jobs are scheduled when milestones are created

**Flow:**
```
Milestone created → ProgrammablePaymentQueueService.scheduleMilestoneCheck()
→ ProgrammablePaymentQueueProcessor.processMilestoneCheck()
→ Check if milestone is COMPLETED
→ Execute executeSettlement() on-chain
→ Enqueue settlement job for off-ramp
```

**Key Methods:**
- `ProgrammablePaymentQueueService.scheduleMilestoneCheck()` - Schedules job
- `ProgrammablePaymentQueueProcessor.processMilestoneCheck()` - Processes milestone

---

### 3.4 Dispute Timeout

**Triggered When:**
- Dispute is raised
- Called from: `EscrowOrderService.raiseDispute()`
- API endpoint: `POST /payment-intents/:intentId/dispute`

**Flow:**
```
API: POST /payment-intents/:intentId/dispute
→ EscrowOrderService.raiseDispute()
→ programmablePaymentQueue.scheduleDisputeTimeout()
→ Job scheduled with delay until dispute window expires
→ ProgrammablePaymentQueueProcessor.processDisputeTimeout()
→ Check if dispute window expired
→ Update order status (manual resolution may be required)
```

**Key Methods:**
- `EscrowOrderService.raiseDispute()` - Creates dispute and schedules job
- `ProgrammablePaymentQueueService.scheduleDisputeTimeout()` - Schedules job with delay
- `ProgrammablePaymentQueueProcessor.processDisputeTimeout()` - Processes when window expires

---

## Complete Flow Example: Escrow Payment with Delivery Proof

```
1. Payment Intent Created
   → IntentService.createIntent()

2. Frontend executes createOrder() on contract
   → Posts transaction hash
   → IntentService.updateTransactionHash()
   → TransactionConfirmationQueue.enqueueConfirmationCheck()

3. Transaction Confirmation Queue
   → Checks receipt status
   → If success: handleTransactionSuccess()
   → Creates EscrowOrder (if needed)
   → Enqueues Settlement Queue (if OFF_RAMP_MOCK)

4. Escrow Order Created
   → EscrowOrderService.createEscrowOrder()
   → scheduleReleaseJobs()
   → For DELIVERY_PROOF: Logs that jobs will be scheduled when proof is submitted

5. Delivery Proof Submitted (via API)
   → EscrowOrderService.submitDeliveryProof()
   → Creates DeliveryProof record
   → ProgrammablePaymentQueue.scheduleDeliveryProofProcess()

6. Programmable Payment Queue (Delivery Proof)
   → processDeliveryProof()
   → If autoReleaseOnProof: Execute executeSettlement() on-chain
   → Enqueue Settlement Queue

7. Settlement Queue
   → process()
   → Check contract state (settlement already executed by programmable queue)
   → Process off-ramp mock (fiat settlement)
   → confirmSettlement() on-chain with fiat transaction hash
   → Update payment intent to SETTLED
```

---

## Queue Dependencies

```
Transaction Confirmation Queue
  ↓ (if success)
Settlement Queue (for immediate settlement)
  OR
Programmable Payment Queue (for escrow-based settlement)
  ↓ (after executeSettlement())
Settlement Queue (for off-ramp processing)
```

---

## Key Points

1. **Transaction Confirmation Queue**: Triggered by frontend posting transaction hash
2. **Settlement Queue**: Triggered after transaction confirmation OR after on-chain settlement execution
3. **Programmable Payment Queue**: Triggered when:
   - Escrow order created (time-lock)
   - Delivery proof submitted (delivery proof)
   - Milestone completed (milestone)
   - Dispute raised (dispute timeout)

4. **All queues read from contract** before processing:
   - Check order state
   - Check settlement state
   - Verify if already executed (idempotent)

5. **Settlement execution flow**:
   - Programmable Payment Queue → `executeSettlement()` on-chain
   - Settlement Queue → Off-ramp processing → `confirmSettlement()` on-chain

