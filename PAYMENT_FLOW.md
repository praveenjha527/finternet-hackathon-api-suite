# Payment Gateway Flow & API Sequence

This document explains the complete payment flow from creation to settlement, including all API endpoints, state transitions, and background processing.

## High-Level Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐      ┌──────────────┐
│   Merchant  │      │  API Server  │      │  Frontend   │      │  Blockchain  │
│  (Backend)  │◄────►│  (NestJS)    │◄────►│ (React App) │◄────►│  (Ethereum)  │
└─────────────┘      └──────────────┘      └─────────────┘      └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   BullMQ     │
                     │  (Redis)     │
                     │   Queues     │
                     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  PostgreSQL  │
                     │  (Database)  │
                     └──────────────┘
```

## Complete Payment Flow

### Phase 1: Payment Intent Creation

**API Endpoint:** `POST /api/v1/payment-intents`

**Request:**
```json
{
  "amount": "100.00",
  "currency": "USD",
  "type": "DELIVERY_VS_PAYMENT",
  "settlementMethod": "OFF_RAMP_MOCK",
  "settlementDestination": "bank_account_123",
  "description": "Order #12345"
}
```

**Headers:**
```
X-API-Key: sk_hackathon_abc123...
```

**Flow:**
1. API Key authentication validates merchant
2. `IntentService.createIntent()`:
   - Validates settlement method
   - Runs compliance checks
   - Generates unique intent ID (`intent_xxx`)
   - Gets merchant's contract address (DvP or Consented Pull)
   - Builds EIP-712 typed data for signature
   - Creates PaymentIntent record in database with status `INITIATED`
   - Generates payment URL: `http://frontend-url/?intent=intent_xxx`
   - Logs audit event: `PAYMENT_INTENT_CREATED`

**Response:**
```json
{
  "id": "intent_xxx",
  "object": "payment_intent",
  "status": "INITIATED",
  "data": {
    "id": "intent_xxx",
    "amount": "100.00",
    "currency": "USD",
    "type": "DELIVERY_VS_PAYMENT",
    "contractAddress": "0x...",
    "paymentUrl": "http://frontend-url/?intent=intent_xxx",
    "typedData": { ... },
    "status": "INITIATED",
    "phases": []
  }
}
```

**Database State:**
- `PaymentIntent`: status = `INITIATED`, phases = `[]`
- `MerchantFiatAccount`: No changes (balance unchanged)

---

### Phase 2: Payer Wallet Connection & Payment Execution

**Frontend Flow (Not API, but part of sequence):**

1. User visits `paymentUrl` from Phase 1
2. Frontend loads: `GET /api/v1/payment-intents/public/:intentId` (no auth required)
3. User connects wallet (MetaMask, WalletConnect, etc.)
4. User signs and executes transaction on blockchain
5. Transaction hash is returned from blockchain

**Note:** The payment execution happens directly on-chain via the frontend. The API does NOT execute the transaction - the payer's wallet does.

---

### Phase 3: Payment Confirmation (Signature + Transaction Submission)

**API Endpoint:** `POST /api/v1/payment-intents/:intentId/confirm`

**Request:**
```json
{
  "signature": "0x...",
  "payerAddress": "0x1234..."
}
```

**Headers:**
```
X-API-Key: sk_hackathon_abc123...
```

**Flow:**
1. API Key authentication validates merchant
2. `IntentService.confirmIntent()`:
   - Validates payment intent exists and belongs to merchant
   - State machine validates transition: `INITIATED` → `PROCESSING`
   - Verifies EIP-712 signature matches `payerAddress`
   - **Submits transaction to blockchain** (via `BlockchainService`)
     - For DvP: Calls `submitDvP()`
     - For Consented Pull: Calls `submitConsentedPull()`
   - Updates PaymentIntent:
     - status = `PROCESSING`
     - signature = `0x...`
     - signerAddress = `0x1234...`
     - transactionHash = `0xabc...`
     - phases = `[{phase: "SIGNATURE_VERIFICATION", status: "COMPLETED"}, {phase: "BLOCKCHAIN_CONFIRMATION", status: "IN_PROGRESS"}]`
   - Logs audit event: `BLOCKCHAIN_TX_SUBMITTED`
   - Emits event: `STATUS_CHANGED` (INITIATED → PROCESSING)

**Response:**
```json
{
  "id": "intent_xxx",
  "status": "PROCESSING",
  "data": {
    "transactionHash": "0xabc...",
    "status": "PROCESSING",
    "phases": [...]
  }
}
```

**Database State:**
- `PaymentIntent`: status = `PROCESSING`, transactionHash = `0xabc...`
- `MerchantFiatAccount`: No changes (balance unchanged - payment not confirmed yet)
- `AuditLog`: New entry for TX submission

---

### Phase 4: Blockchain Confirmation (Polling)

**API Endpoint:** `GET /api/v1/payment-intents/:intentId`

**Headers:**
```
X-API-Key: sk_hackathon_abc123...
```

**Flow (when transaction has 5+ confirmations):**

1. Merchant polls this endpoint to check payment status
2. `IntentService.getIntent()`:
   - Checks blockchain for transaction confirmations
   - If confirmations >= 5:
     - State machine validates: `PROCESSING` → `SUCCEEDED`
     - Updates PaymentIntent:
       - status = `SUCCEEDED`
       - settlementStatus = `IN_PROGRESS`
       - phases = `[{phase: "BLOCKCHAIN_CONFIRMATION", status: "COMPLETED"}, ...]`
     - **CREDITS MERCHANT ACCOUNT** (NEW!):
       ```typescript
       await ledger.credit(merchantId, amount, {
         paymentIntentId: intentId,
         description: "Payment received: intent_xxx"
       })
       ```
       - Increases `availableBalance` in `MerchantFiatAccount`
       - Creates `LedgerEntry` with type `CREDIT`
     - Logs audit event: `BLOCKCHAIN_TX_CONFIRMED`
     - Emits events: `BLOCKCHAIN_TX_CONFIRMED`, `STATUS_CHANGED`
     - **Enqueues settlement job** to BullMQ queue
       - Job data: `{paymentIntentId, merchantId, amount, currency, settlementMethod, settlementDestination}`
       - Job name: `process-settlement`

**Response:**
```json
{
  "id": "intent_xxx",
  "status": "SUCCEEDED",
  "data": {
    "status": "SUCCEEDED",
    "settlementStatus": "IN_PROGRESS",
    "phases": [
      { "phase": "BLOCKCHAIN_CONFIRMATION", "status": "COMPLETED" },
      { "phase": "ESCROW_LOCKED", "status": "COMPLETED" }
    ]
  }
}
```

**Database State:**
- `PaymentIntent`: status = `SUCCEEDED`, settlementStatus = `IN_PROGRESS`
- `MerchantFiatAccount`: `availableBalance` increased by $100.00
- `LedgerEntry`: New entry with type `CREDIT`, amount = "100.00"
- `AuditLog`: New entry for TX confirmation
- BullMQ Queue: Job added to `settlement` queue

---

### Phase 5: Settlement Processing (Background Job)

**Queue:** BullMQ `settlement` queue

**Processor:** `SettlementQueueProcessor.process()`

**Flow (Asynchronous, runs in background):**

1. BullMQ worker picks up job from queue
2. `SettlementQueueProcessor.process()`:
   - Gets payment intent from database
   - Calls `SettlementService.processOffRampMock()`:
     - Simulates bank gateway delay (configurable, default 10 seconds)
     - Generates mock settlement transaction ID
     - **Records settlement in ledger**:
       ```typescript
       // Step 1: Reserve funds (move from available to reserved)
       await ledger.createEntry({
         transactionType: 'RESERVE',
         amount: "100.00"
       })
       
       // Step 2: Record settlement (debit from reserved)
       await ledger.createEntry({
         transactionType: 'SETTLEMENT',
         amount: "100.00",
         settlementMethod: "OFF_RAMP_MOCK",
         settlementTxId: "ACH_xxx"
       })
       ```
       - Decreases `availableBalance` (funds sent to merchant's bank)
       - Creates `LedgerEntry` with type `SETTLEMENT`
   - If settlement succeeds:
     - Updates PaymentIntent:
       - status = `SETTLED`
       - settlementStatus = `COMPLETED`
       - phases = `[{phase: "SETTLEMENT", status: "COMPLETED"}, ...]`
     - Logs audit event: `SETTLEMENT_COMPLETED`
     - Emits events: `SETTLEMENT_COMPLETED`, `STATUS_CHANGED` (SUCCEEDED → SETTLED)
   - If settlement fails:
     - Updates PaymentIntent:
       - settlementStatus = `FAILED`
       - phases = `[{phase: "SETTLEMENT", status: "FAILED"}, ...]`
     - Logs audit event: `SETTLEMENT_COMPLETED` (with failed status)
     - Balance remains unchanged (settlement failed, still owe merchant)

**Database State (after successful settlement):**
- `PaymentIntent`: status = `SETTLED`, settlementStatus = `COMPLETED`
- `MerchantFiatAccount`: `availableBalance` decreased by $100.00 (funds sent to bank)
- `LedgerEntry`: Two new entries:
  - Type `RESERVE`: Moved funds to reserved
  - Type `SETTLEMENT`: Debited funds (sent to bank)
- `AuditLog`: New entry for settlement completion

---

### Phase 6: Optional - Refund Processing

**API Endpoint:** `POST /api/v1/payment-intents/:intentId/refund` (not yet implemented, but service exists)

**Request:**
```json
{
  "amount": "50.00",
  "reason": "Customer requested refund"
}
```

**Flow:**
1. `RefundService.processRefund()`:
   - Validates payment status is `SUCCEEDED` or `SETTLED`
   - Validates refund amount <= payment amount
   - **Records refund in ledger**:
     ```typescript
     await ledger.recordRefund(merchantId, amount, {
       paymentIntentId: intentId,
       refundId: "refund_xxx"
     })
     ```
     - Decreases `availableBalance` (merchant refunds customer)
     - Creates `LedgerEntry` with type `REFUND`
   - Logs audit event (if audit method exists)

**Database State:**
- `MerchantFiatAccount`: `availableBalance` decreased by refund amount
- `LedgerEntry`: New entry with type `REFUND`

---

### Phase 7: Optional - Chargeback Processing

**API Endpoint:** `POST /api/v1/payment-intents/:intentId/chargeback` (not yet implemented, but service exists)

**Request:**
```json
{
  "amount": "100.00",
  "disputeReason": "Fraudulent transaction"
}
```

**Flow:**
1. `ChargebackService.processChargeback()`:
   - Validates payment status is `SUCCEEDED` or `SETTLED`
   - **Records chargeback in ledger**:
     ```typescript
     await ledger.recordChargeback(merchantId, amount, {
       paymentIntentId: intentId,
       disputeReason: "Fraudulent transaction"
     })
     ```
     - Decreases `availableBalance` (merchant loses money)
     - Creates `LedgerEntry` with type `CHARGEBACK`
   - Logs audit event (if audit method exists)

**Database State:**
- `MerchantFiatAccount`: `availableBalance` decreased by chargeback amount
- `LedgerEntry`: New entry with type `CHARGEBACK`

---

## State Machine Transitions

```
INITIATED
  ↓ (signature verified)
REQUIRES_SIGNATURE (optional, can skip)
  ↓ (transaction submitted)
PROCESSING
  ↓ (5+ confirmations)
SUCCEEDED
  ↓ (settlement completed)
SETTLED
  ↓ (optional)
FINAL

Invalid transitions:
- CANCELED (terminal state)
- REQUIRES_ACTION (for errors/retries)
```

---

## Balance Flow Example

**Initial State:**
- Merchant balance: $10,000.00

**After Payment Succeeds (Phase 4):**
- Payment: +$100.00
- Balance: $10,100.00 ✅

**After Settlement (Phase 5):**
- Settlement: -$100.00 (sent to bank)
- Balance: $10,000.00 ✅

**After Refund (Phase 6, if occurs):**
- Refund: -$50.00
- Balance: $9,950.00 ✅

**After Chargeback (Phase 7, if occurs):**
- Chargeback: -$100.00
- Balance: $9,850.00 ✅

---

## Key Services & Responsibilities

1. **IntentService**: Payment intent lifecycle, blockchain confirmation, state transitions
2. **BlockchainService**: Submits transactions to blockchain, checks confirmations
3. **SettlementService**: Processes off-ramp settlements (mocks bank gateway)
4. **LedgerService**: Manages fiat account balances and ledger entries
5. **FiatAccountService**: Manages merchant fiat account records
6. **RefundService**: Processes refunds
7. **ChargebackService**: Processes chargebacks/disputes
8. **AuditService**: Logs all critical events for compliance
9. **PaymentStateMachineService**: Validates state transitions
10. **PaymentEventService**: Emits events for event-driven architecture
11. **SettlementQueueService**: Manages BullMQ queue operations
12. **SettlementQueueProcessor**: Processes settlement jobs asynchronously

---

## Queue-Based Processing

**Current Queues:**
- `settlement`: Processes off-ramp settlements asynchronously

**Why Queues?**
- Settlement involves delays (bank processing time)
- Non-blocking: API responds immediately, settlement happens in background
- Retry logic: Failed settlements can be retried automatically
- Scalability: Multiple workers can process settlements in parallel

**Future Queue Candidates:**
- `refund`: If refunds involve external API calls
- `chargeback`: If chargebacks come from webhooks and need async processing
- `notification`: For sending emails/SMS to merchants

---

## API Endpoints Summary

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/v1/payment-intents` | API Key | Create payment intent |
| GET | `/api/v1/payment-intents/:id` | API Key | Get payment intent (merchant) |
| GET | `/api/v1/payment-intents/public/:id` | None | Get payment intent (public, for frontend) |
| POST | `/api/v1/payment-intents/:id/confirm` | API Key | Confirm payment (signature + submit TX) |
| POST | `/api/v1/payment-intents/:id/refund` | API Key | Process refund (future) |
| POST | `/api/v1/payment-intents/:id/chargeback` | API Key | Process chargeback (future) |

---

## Error Handling

- **State Machine Violations**: Returns 400 with error code `invalid_state_transition`
- **Authentication Failures**: Returns 403 with error code `forbidden`
- **Resource Not Found**: Returns 404 with error code `resource_missing`
- **Signature Verification**: Returns 400 with error code `signature_verification_failed`
- **Settlement Failures**: Logged, payment status updated, balance unchanged
- **Credit Failures**: Logged, payment confirmation continues (non-blocking)

---

## Testing the Flow

1. **Create Intent:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/payment-intents \
     -H "X-API-Key: sk_hackathon_xxx" \
     -H "Content-Type: application/json" \
     -d '{"amount": "100.00", "currency": "USD", "type": "DELIVERY_VS_PAYMENT", "settlementMethod": "OFF_RAMP_MOCK", "settlementDestination": "bank_123"}'
   ```

2. **Confirm Payment:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/payment-intents/intent_xxx/confirm \
     -H "X-API-Key: sk_hackathon_xxx" \
     -H "Content-Type: application/json" \
     -d '{"signature": "0x...", "payerAddress": "0x1234..."}'
   ```

3. **Check Status:**
   ```bash
   curl http://localhost:3000/api/v1/payment-intents/intent_xxx \
     -H "X-API-Key: sk_hackathon_xxx"
   ```

4. **Monitor Queue:**
   - Check Redis for BullMQ queue status
   - Settlement job will process automatically

---

## Timeline Example

```
T+0s:   POST /payment-intents (status: INITIATED)
T+2s:   POST /payment-intents/:id/confirm (status: PROCESSING)
T+5s:   GET /payment-intents/:id (status: SUCCEEDED, balance +$100)
T+15s:  Settlement job processes (status: SETTLED, balance -$100)
```

---

This flow ensures:
- ✅ Payments are only credited after blockchain confirmation
- ✅ Settlements happen asynchronously (non-blocking)
- ✅ Complete audit trail for compliance
- ✅ State machine enforces valid transitions
- ✅ Event-driven architecture for extensibility
- ✅ Proper balance tracking (credit on success, debit on settlement)

