# Complete Payment Flow Test Scenario

This document outlines a complete end-to-end test scenario for the payment gateway.

## Prerequisites

1. API server running: `bun run start:dev`
2. Redis running (for queues)
3. PostgreSQL running (for database)
4. Frontend running (optional, for wallet interaction)
5. API key from seeded merchants

## Get Your API Key

First, check your seeded merchants:
```bash
cd api
bun run prisma:seed
```

Or query the database directly:
```sql
SELECT id, name, "apiKey" FROM "Merchant" LIMIT 1;
```

## Test Scenario 1: Basic Payment Intent Creation

### Step 1: Create Payment Intent

```bash
curl -X POST http://localhost:3000/api/v1/payment-intents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_hackathon_your_key_here" \
  -d '{
    "amount": "1000.00",
    "currency": "USDC",
    "type": "DELIVERY_VS_PAYMENT",
    "settlementMethod": "OFF_RAMP_MOCK",
    "settlementDestination": "9876543210",
    "description": "Test Order #TEST-001",
    "deliveryPeriod": 2592000,
    "autoRelease": true,
    "metadata": {
      "orderId": "TEST-001",
      "customerId": "CUST-001"
    }
  }' | jq '.'
```

**Expected Response:**
- Status: `201 Created`
- Payment Intent ID: `intent_xxx`
- Status: `INITIATED`
- `paymentUrl`: URL to frontend (if `FRONTEND_URL` is set)
- `typedData`: EIP-712 data for signing

**Save the `intent_xxx` ID for next steps!**

---

### Step 2: Get Payment Intent

```bash
INTENT_ID="intent_xxx"  # Replace with your intent ID
API_KEY="sk_hackathon_your_key_here"

curl -X GET "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}" \
  -H "X-API-Key: ${API_KEY}" | jq '.'
```

**Expected Response:**
- Status: `200 OK`
- Payment Intent details

---

### Step 3: Get Public Payment Intent (No Auth)

```bash
curl -X GET "http://localhost:3000/api/v1/payment-intents/public/${INTENT_ID}" | jq '.'
```

**Expected Response:**
- Status: `200 OK`
- Payment Intent details (no API key needed)

---

## Test Scenario 2: Wallet Interaction (Frontend)

1. **Visit Payment URL**: Open the `paymentUrl` from Step 1 in a browser
2. **Connect Wallet**: Use MetaMask, WalletConnect, etc.
3. **Sign Typed Data**: Sign the EIP-712 data
4. **Approve Tokens**: Approve ERC-20 spending (if needed)
5. **Execute Transaction**: Call `createOrder()` or `initiatePull()` on the contract
6. **Get Transaction Hash**: Save the transaction hash

**Note**: For testing without frontend, you can skip this step and mock the transaction hash.

---

## Test Scenario 3: Payment Confirmation

After the transaction is submitted on-chain, you can optionally call the confirm endpoint:

```bash
curl -X POST "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}/confirm" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "signature": "0x...",
    "payerAddress": "0x..."
  }' | jq '.'
```

**Expected Response:**
- Status: `200 OK`
- Updated status: `PROCESSING`
- Signature stored

---

## Test Scenario 4: Payment Status (Polling)

Poll the payment intent to check for blockchain confirmation:

```bash
curl -X GET "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}" \
  -H "X-API-Key: ${API_KEY}" | jq '.data.status'
```

**Expected Status Transitions:**
- `INITIATED` → `PROCESSING` → `SUCCEEDED` (when 5+ confirmations)
- When `SUCCEEDED`:
  - Escrow order is automatically created
  - Settlement job is queued
  - Merchant account is credited

---

## Test Scenario 5: Escrow Order Operations

### Get Escrow Order

```bash
curl -X GET "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}/escrow" \
  -H "X-API-Key: ${API_KEY}" | jq '.'
```

**Expected Response (after payment confirmed):**
- Escrow Order details
- Status: `PENDING`
- Delivery deadline
- Release type

---

### Submit Delivery Proof

```bash
curl -X POST "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}/escrow/delivery-proof" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "proofHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "proofURI": "https://example.com/delivery-proofs/12345",
    "submittedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    "submitTxHash": "0x..."
  }' | jq '.'
```

**Expected Response:**
- Status: `200 OK`
- Delivery Proof ID
- Escrow order status updated to `DELIVERED`
- If `autoRelease: true`, funds are automatically released

---

### Raise Dispute

```bash
curl -X POST "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}/escrow/dispute" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "reason": "Item not delivered as described",
    "raisedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    "disputeWindow": "604800"
  }' | jq '.'
```

**Expected Response:**
- Status: `200 OK`
- Escrow order status updated to `DISPUTED`
- Dispute timeout job scheduled

---

## Test Scenario 6: Milestone-Based Payments

### Create Milestone (for MILESTONE_LOCKED orders)

```bash
curl -X POST "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}/escrow/milestones" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "milestoneIndex": 0,
    "description": "Initial payment",
    "amount": "500.00",
    "percentage": 50
  }' | jq '.'
```

### Complete Milestone

```bash
MILESTONE_ID="milestone_xxx"  # From create milestone response

curl -X POST "http://localhost:3000/api/v1/payment-intents/${INTENT_ID}/escrow/milestones/${MILESTONE_ID}/complete" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "completionProof": "0x...",
    "completionProofURI": "https://example.com/milestone-proofs/12345",
    "completedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318"
  }' | jq '.'
```

---

## Test Scenario 7: Check Queue Processing

### Monitor Logs

Watch the server logs for queue processor activity:

```bash
# In the server terminal, you should see:
# - "SettlementQueueProcessor initialized and ready to process jobs"
# - "ProgrammablePaymentQueueProcessor initialized and ready to process jobs"
# - "Processing settlement job for payment intent: intent_xxx"
# - "Processing programmable payment job: ..."
```

### Check Redis Queue

```bash
redis-cli
> KEYS bull:*
> GET bull:settlement:meta
> GET bull:programmable-payment:meta
```

---

## Test Scenario 8: Verify Settlement

After a payment is `SUCCEEDED` and settlement job runs:

1. Check payment intent status (should be `SETTLED`)
2. Check merchant fiat account balance (should be credited)
3. Check ledger entries (should show credit entry)

---

## Complete Test Checklist

- [ ] Create payment intent
- [ ] Get payment intent (authenticated)
- [ ] Get payment intent (public)
- [ ] Wallet interaction (optional)
- [ ] Payment confirmation (optional)
- [ ] Payment status polling
- [ ] Escrow order creation (automatic)
- [ ] Submit delivery proof
- [ ] Raise dispute (optional)
- [ ] Create milestone (optional)
- [ ] Complete milestone (optional)
- [ ] Verify settlement
- [ ] Check queue logs
- [ ] Verify audit logs

---

## Quick Test Script

Use the provided shell script:

```bash
cd api
export API_KEY="sk_hackathon_your_key_here"
./scripts/test-payment-flow.sh
```

Or manually run each step using the curl commands above.

