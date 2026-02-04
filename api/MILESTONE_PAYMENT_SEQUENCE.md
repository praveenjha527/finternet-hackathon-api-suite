# Milestone-based payment – API sequence

Base URL: `http://localhost:3000/api/v1`  
All merchant endpoints need: `X-API-Key: sk_hackathon_...` (or `sk_test_*` / `sk_live_*`).

---

## 1. Create payment intent (milestone-based)

Create a **DELIVERY_VS_PAYMENT** intent with **metadata.releaseType = "MILESTONE_LOCKED"** so the escrow order is milestone-based.

```http
POST /payment-intents
Content-Type: application/json
X-API-Key: sk_hackathon_YOUR_KEY
```

```json
{
  "amount": "3000.00",
  "currency": "USDC",
  "type": "DELIVERY_VS_PAYMENT",
  "settlementMethod": "OFF_RAMP_TO_RTP",
  "settlementDestination": "9876543210",
  "description": "Project with 3 milestones",
  "metadata": {
    "releaseType": "MILESTONE_LOCKED",
    "orderId": "PROJ-001"
  },
  "deliveryPeriod": 2592000,
  "expectedDeliveryHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "autoRelease": false,
  "deliveryOracle": "0x0000000000000000000000000000000000000000"
}
```

**Important:** `metadata.releaseType` must be `"MILESTONE_LOCKED"` for milestone-based release.

Response: payment intent with `id` (e.g. `pi_xxx`). Save `id` for all following steps.

---

## 2. Confirm payment (fund escrow)

Funds must be in escrow before creating milestones. Use either **Web3 (wallet)** or **Web2 (card)**.

### Option A – Web3 (wallet)

1. **Get payment intent (public)**  
   `GET /payment-intents/public/{intentId}`  
   No API key. Use response to build EIP-712 payload and have user sign in wallet.

2. **Submit transaction hash** (after user sends tx on-chain)  
   `POST /payment-intents/public/{intentId}/transaction-hash`  
   Body: `{ "transactionHash": "0x..." }`

3. **Confirm intent** (with signature)  
   `POST /payment-intents/{intentId}/confirm`  
   With API key. Body: `{ "signature": "0x...", "payerAddress": "0x..." }`

### Option B – Web2 (card)

Single call (no API key):

```http
POST /payment-intents/public/{intentId}/payment
Content-Type: application/json
```

```json
{
  "card": {
    "cardNumber": "4242424242424242",
    "expiry": "12/25",
    "cvv": "123",
    "name": "John Doe",
    "addressLine1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "US"
  }
}
```

After step 2, the escrow order exists with `releaseType: "MILESTONE_LOCKED"`. You can continue with milestones.

---

## 3. Get escrow order (optional)

Inspect the escrow order and, later, list milestones.

```http
GET /payment-intents/{intentId}/escrow
X-API-Key: sk_hackathon_YOUR_KEY
```

Response includes `releaseType`, `orderStatus`, and `milestones` array.

---

## 4. Create milestones

Define how much is released at each milestone. Call once per milestone; `milestoneIndex` must be unique per order (e.g. 0, 1, 2).

```http
POST /payment-intents/{intentId}/escrow/milestones
Content-Type: application/json
X-API-Key: sk_hackathon_YOUR_KEY
```

**Milestone 1 (index 0):**
```json
{
  "milestoneIndex": 0,
  "description": "Kickoff – design approved",
  "amount": "1000.00"
}
```

**Milestone 2 (index 1):**
```json
{
  "milestoneIndex": 1,
  "description": "Phase 2 – development complete",
  "amount": "1000.00"
}
```

**Milestone 3 (index 2):**
```json
{
  "milestoneIndex": 2,
  "description": "Final delivery",
  "amount": "1000.00"
}
```

Each response includes the created milestone `id` (e.g. `ms_xxx`). Save these for step 5.

---

## 5. Complete a milestone (release funds for that milestone)

When a milestone is done, call complete. Backend marks it completed and the programmable-payment queue releases that milestone’s amount to the merchant.

```http
POST /payment-intents/{intentId}/escrow/milestones/{milestoneId}/complete
Content-Type: application/json
X-API-Key: sk_hackathon_YOUR_KEY
```

```json
{
  "completionProof": "proof_0xabcdef...",
  "completionProofURI": "https://example.com/milestone-proofs/1",
  "completedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318"
}
```

- `completedBy` is required (address of who completes the milestone).
- `completionProof` and `completionProofURI` are optional.

Repeat for each milestone when it’s done (use the correct `milestoneId` from step 4).

---

## Sequence summary

| Step | Method | Path | Purpose |
|------|--------|------|--------|
| 1 | POST | `/payment-intents` | Create intent with `metadata.releaseType: "MILESTONE_LOCKED"` |
| 2a | GET | `/payment-intents/public/:intentId` | Get intent for wallet flow |
| 2b | POST | `/payment-intents/public/:intentId/transaction-hash` | Submit on-chain tx hash |
| 2c | POST | `/payment-intents/:intentId/confirm` | Confirm with signature (Web3) |
| **or** 2 | POST | `/payment-intents/public/:intentId/payment` | Pay with card and create escrow (Web2) |
| 3 | GET | `/payment-intents/:intentId/escrow` | Get escrow order (and milestones) |
| 4 | POST | `/payment-intents/:intentId/escrow/milestones` | Create each milestone (index, amount, description) |
| 5 | POST | `/payment-intents/:intentId/escrow/milestones/:milestoneId/complete` | Complete a milestone → release its funds |

---

## cURL commands (copy-paste)

Set your API key and base URL once, then run in order. Replace `YOUR_INTENT_ID` and `YOUR_MILESTONE_ID` with values from the responses.

```bash
# Set these before running
export API_KEY="sk_hackathon_YOUR_KEY"
export BASE="http://localhost:3000/api/v1"
```

### Step 1 – Create milestone-based payment intent

```bash
curl -s -X POST "$BASE/payment-intents" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "3000.00",
    "currency": "USDC",
    "type": "DELIVERY_VS_PAYMENT",
    "settlementMethod": "OFF_RAMP_TO_RTP",
    "settlementDestination": "9876543210",
    "description": "Project with 3 milestones",
    "metadata": { "releaseType": "MILESTONE_LOCKED", "orderId": "PROJ-001" },
    "deliveryPeriod": 2592000,
    "expectedDeliveryHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "autoRelease": false,
    "deliveryOracle": "0x0000000000000000000000000000000000000000"
  }'
```

Save the `data.id` from the response as `INTENT_ID` (e.g. `pi_xxx`).

### Step 2 – Pay with card (Web2) to fund escrow

Replace `YOUR_INTENT_ID` with the id from step 1.

```bash
export INTENT_ID="YOUR_INTENT_ID"

curl -s -X POST "$BASE/payment-intents/public/$INTENT_ID/payment" \
  -H "Content-Type: application/json" \
  -d '{
    "card": {
      "cardNumber": "4242424242424242",
      "expiry": "12/25",
      "cvv": "123",
      "name": "John Doe",
      "addressLine1": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "US"
    }
  }'
```

### Step 3 – Get escrow order (see order and milestones)

```bash
curl -s "$BASE/payment-intents/$INTENT_ID/escrow" \
  -H "X-API-Key: $API_KEY"
```

### Step 4 – Create milestones (run each, save each milestone `id`)

```bash
# Milestone 0
curl -s -X POST "$BASE/payment-intents/$INTENT_ID/escrow/milestones" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"milestoneIndex":0,"description":"Kickoff – design approved","amount":"1000.00"}'

# Milestone 1
curl -s -X POST "$BASE/payment-intents/$INTENT_ID/escrow/milestones" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"milestoneIndex":1,"description":"Phase 2 – development complete","amount":"1000.00"}'

# Milestone 2
curl -s -X POST "$BASE/payment-intents/$INTENT_ID/escrow/milestones" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"milestoneIndex":2,"description":"Final delivery","amount":"1000.00"}'
```

Save each response `data.id` (e.g. `ms_xxx`) for step 5.

### Step 5 – Complete a milestone (release funds for that milestone)

Replace `YOUR_MILESTONE_ID` with one of the milestone ids from step 4.

```bash
export MILESTONE_ID="YOUR_MILESTONE_ID"

curl -s -X POST "$BASE/payment-intents/$INTENT_ID/escrow/milestones/$MILESTONE_ID/complete" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "completionProof": "proof_0xabcdef",
    "completionProofURI": "https://example.com/milestone-proofs/1",
    "completedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318"
  }'
```

Repeat step 5 for each milestone when it is done (use the corresponding `MILESTONE_ID`).

---

### One-liner curls (no env vars)

Replace `YOUR_KEY`, `YOUR_INTENT_ID`, and `YOUR_MILESTONE_ID` in the URLs/headers.

```bash
# 1. Create intent
curl -s -X POST http://localhost:3000/api/v1/payment-intents -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"amount":"3000.00","currency":"USD","type":"DELIVERY_VS_PAYMENT","settlementMethod":"OFF_RAMP_TO_RTP","settlementDestination":"9876543210","metadata":{"releaseType":"MILESTONE_LOCKED"}}'

# 2. Pay with card (use intent id from above)
curl -s -X POST http://localhost:3000/api/v1/payment-intents/public/YOUR_INTENT_ID/payment -H "Content-Type: application/json" -d '{"card":{"cardNumber":"4242424242424242","expiry":"12/25","cvv":"123","name":"John Doe","addressLine1":"123 Main St","city":"New York","state":"NY","zipCode":"10001","country":"US"}}'

# 3. Get escrow
curl -s http://localhost:3000/api/v1/payment-intents/YOUR_INTENT_ID/escrow -H "X-API-Key: YOUR_KEY"

# 4. Create milestone 0
curl -s -X POST http://localhost:3000/api/v1/payment-intents/YOUR_INTENT_ID/escrow/milestones -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"milestoneIndex":0,"description":"Phase 1","amount":"1000.00"}'

# 5. Complete milestone (use milestone id from step 4 response)
curl -s -X POST http://localhost:3000/api/v1/payment-intents/YOUR_INTENT_ID/escrow/milestones/YOUR_MILESTONE_ID/complete -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"completedBy":"0x742d35Cc6634C0532925a3b844Bc9e7595f42318"}'
```
