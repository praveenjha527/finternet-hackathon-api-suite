# Finternet Payment Gateway API

**Version:** 0.1.0
**Base URL:** `http://localhost:3000/api/v1`
**Description:** Trustless payment infrastructure for programmable money movement

---

## Table of Contents

1. [Authentication](#authentication)
2. [Overview](#overview)
3. [Payment Intents](#payment-intents)
   - [Create Payment Intent](#create-payment-intent)
   - [Get Payment Intent](#get-payment-intent)
   - [Get Public Payment Intent](#get-public-payment-intent)
   - [Confirm Payment Intent](#confirm-payment-intent)
   - [Update Transaction Hash](#update-transaction-hash)
   - [Process Payment (Web2 Flow)](#process-payment-web2-flow)
4. [Escrow Operations](#escrow-operations)
   - [Get Escrow Order](#get-escrow-order)
   - [Submit Delivery Proof](#submit-delivery-proof)
   - [Raise Dispute](#raise-dispute)
5. [Milestone Management](#milestone-management)
   - [Create Milestone](#create-milestone)
   - [Complete Milestone](#complete-milestone)
6. [Data Models](#data-models)
7. [Error Handling](#error-handling)
8. [Status Codes & Enums](#status-codes--enums)

---

## Authentication

### API Key Authentication

All protected endpoints require an API Key passed in the request header.

| Header | Description |
|--------|-------------|
| `X-API-Key` | API Key for authentication. Format: `sk_hackathon_*`, `sk_test_*`, or `sk_live_*` |

**Example:**
```
X-API-Key: sk_test_abc123xyz789
```

**Note:** Some endpoints are marked as **Public** and do not require authentication.

---

## Overview

The Finternet Payment Gateway API provides a comprehensive set of endpoints for managing programmable payments with escrow functionality. It supports both Web3 (blockchain-based) and Web2 (card-based) payment flows.

### Key Concepts

- **Payment Intent:** Represents a customer's intention to pay. Contains amount, currency, settlement details, and blockchain transaction data.
- **Escrow Order:** Holds funds in escrow until delivery conditions are met.
- **Delivery Proof:** Evidence that goods/services have been delivered.
- **Milestones:** Staged payment releases for milestone-based projects.

### Payment Types

| Type | Description |
|------|-------------|
| `DELIVERY_VS_PAYMENT` | DvP escrow-based payments with delivery verification |
| `CONSENTED_PULL` | Pull-based payments with user consent |

### Settlement Methods

| Method | Description |
|--------|-------------|
| `OFF_RAMP_TO_RTP` | Off-ramp to Real-Time Payments |
| `OFF_RAMP_TO_ACH` | Off-ramp to ACH transfer |
| `OFF_RAMP_TO_WIRE` | Off-ramp to wire transfer |

---

## Payment Intents

### Create Payment Intent

Creates a new payment intent for processing.

```
POST /payment-intents
```

**Authentication:** Required (API Key)

#### Request Headers

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `X-API-Key` | string | Yes | Merchant API key |
| `Content-Type` | string | Yes | `application/json` |

#### Request Body

```json
{
  "amount": "1000.00",
  "currency": "USDC",
  "type": "DELIVERY_VS_PAYMENT",
  "settlementMethod": "OFF_RAMP_TO_RTP",
  "settlementDestination": "9876543210",
  "description": "Order #ORD-123",
  "metadata": {
    "orderId": "ORD-123",
    "merchantId": "MERCHANT-456"
  },
  "deliveryPeriod": 2592000,
  "expectedDeliveryHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "autoRelease": true,
  "deliveryOracle": "0x0000000000000000000000000000000000000000"
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | string | Yes | Payment amount as a decimal string (e.g., "1000.00") |
| `currency` | string | Yes | Currency code (e.g., "USDC", "USD") |
| `type` | string | Yes | Payment type: `DELIVERY_VS_PAYMENT`, `CONSENTED_PULL` |
| `settlementMethod` | string | Yes | Settlement method for the payment |
| `settlementDestination` | string | Yes | Destination for settlement (account number, wallet address) |
| `description` | string | No | Human-readable description of the payment |
| `metadata` | object | No | Custom key-value pairs for tracking |
| `deliveryPeriod` | number | No | Delivery period in seconds (default: 2592000 = 30 days) |
| `expectedDeliveryHash` | string | No | Expected delivery hash (bytes32 hex string) |
| `autoRelease` | boolean | No | Auto-release funds when delivery proof is submitted |
| `deliveryOracle` | string | No | Delivery oracle address (zero address if not used) |

#### Response (201 Created)

```json
{
  "id": "pi_abc123xyz789",
  "object": "payment_intent",
  "status": "INITIATED",
  "data": {
    "id": "pi_abc123xyz789",
    "object": "payment_intent",
    "status": "INITIATED",
    "amount": "1000.00",
    "currency": "USDC",
    "type": "DELIVERY_VS_PAYMENT",
    "description": "Order #ORD-123",
    "settlementMethod": "OFF_RAMP_TO_RTP",
    "settlementDestination": "9876543210",
    "settlementStatus": null,
    "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "transactionHash": null,
    "chainId": 11155111,
    "typedData": { ... },
    "signature": null,
    "signerAddress": null,
    "estimatedFee": "0.50",
    "estimatedDeliveryTime": "30 minutes",
    "phases": [
      {
        "phase": "SIGNATURE_VERIFICATION",
        "status": "IN_PROGRESS"
      }
    ],
    "metadata": {
      "orderId": "ORD-123",
      "merchantId": "MERCHANT-456"
    },
    "paymentUrl": "http://localhost:5173/pay/pi_abc123xyz789",
    "created": 1706792400,
    "updated": 1706792400
  },
  "metadata": {
    "orderId": "ORD-123",
    "merchantId": "MERCHANT-456"
  },
  "created": 1706792400,
  "updated": 1706792400
}
```

---

### Get Payment Intent

Retrieves a payment intent by ID (authenticated).

```
GET /payment-intents/{intentId}
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Response (200 OK)

```json
{
  "id": "pi_abc123xyz789",
  "object": "payment_intent",
  "status": "PROCESSING",
  "data": {
    "id": "pi_abc123xyz789",
    "object": "payment_intent",
    "status": "PROCESSING",
    "amount": "1000.00",
    "currency": "USDC",
    "type": "DELIVERY_VS_PAYMENT",
    "description": "Order #ORD-123",
    "settlementMethod": "OFF_RAMP_TO_RTP",
    "settlementDestination": "9876543210",
    "settlementStatus": "PENDING",
    "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "chainId": 11155111,
    "typedData": { ... },
    "signature": "0x1234...",
    "signerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    "phases": [
      {
        "phase": "SIGNATURE_VERIFICATION",
        "status": "COMPLETED",
        "timestamp": 1706792450
      },
      {
        "phase": "ESCROW_LOCKED",
        "status": "COMPLETED",
        "timestamp": 1706792500
      },
      {
        "phase": "AWAITING_DELIVERY_PROOF",
        "status": "IN_PROGRESS"
      }
    ],
    "metadata": { ... },
    "paymentUrl": null,
    "created": 1706792400,
    "updated": 1706792500
  },
  "created": 1706792400,
  "updated": 1706792500
}
```

---

### Get Public Payment Intent

Retrieves a payment intent without authentication (for frontend wallet interface).

```
GET /payment-intents/public/{intentId}
```

**Authentication:** Not Required (Public)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Response (200 OK)

Same response structure as [Get Payment Intent](#get-payment-intent).

---

### Confirm Payment Intent

Confirms a payment intent with signature and payer information.

```
POST /payment-intents/{intentId}/confirm
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Request Body

```json
{
  "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
  "payerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
  "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signature` | string | Yes | EIP-712 signature from the payer |
| `payerAddress` | string | Yes | Ethereum address of the payer (must be valid) |
| `transactionHash` | string | No | Transaction hash from blockchain (optional, can be provided later) |

#### Response (200 OK)

```json
{
  "id": "pi_abc123xyz789",
  "object": "payment_intent",
  "status": "PAYMENT_CONFIRMED",
  "data": {
    "id": "pi_abc123xyz789",
    "object": "payment_intent",
    "status": "PAYMENT_CONFIRMED",
    "amount": "1000.00",
    "currency": "USDC",
    "type": "DELIVERY_VS_PAYMENT",
    "signature": "0x1234...",
    "signerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    "transactionHash": "0xabcdef...",
    "phases": [
      {
        "phase": "SIGNATURE_VERIFICATION",
        "status": "COMPLETED",
        "timestamp": 1706792450
      },
      {
        "phase": "ESCROW_LOCKED",
        "status": "IN_PROGRESS"
      }
    ],
    ...
  },
  "created": 1706792400,
  "updated": 1706792500
}
```

---

### Update Transaction Hash

Updates a payment intent with the blockchain transaction hash (public endpoint).

```
POST /payment-intents/public/{intentId}/transaction-hash
```

**Authentication:** Not Required (Public)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Request Body

```json
{
  "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transactionHash` | string | Yes | Blockchain transaction hash |

#### Response (200 OK)

Returns the updated payment intent with the new transaction hash.

---

### Process Payment (Web2 Flow)

Processes a payment with card details for Web2 payment flow.

```
POST /payment-intents/public/{intentId}/payment
```

**Authentication:** Not Required (Public)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Request Body

```json
{
  "card": {
    "cardNumber": "4242424242424242",
    "expiry": "12/25",
    "cvv": "123",
    "name": "John Doe",
    "addressLine1": "123 Main St",
    "addressLine2": "Apt 4B",
    "city": "New York",
    "state": "NY",
    "zipCode": "10001",
    "country": "US"
  }
}
```

#### Card Details Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cardNumber` | string | Yes | Card number (13-19 digits, spaces allowed) |
| `expiry` | string | Yes | Card expiry in MM/YY format |
| `cvv` | string | Yes | Card CVV (3-4 digits) |
| `name` | string | Yes | Cardholder name |
| `addressLine1` | string | No | Billing address line 1 |
| `addressLine2` | string | No | Billing address line 2 |
| `city` | string | No | City |
| `state` | string | No | State (2 characters) |
| `zipCode` | string | No | ZIP code |
| `country` | string | No | Country code (ISO 3166-1 alpha-2, 2 characters) |

#### Response (200 OK)

```json
{
  "id": "pi_abc123xyz789",
  "object": "payment_intent",
  "status": "PROCESSING",
  "data": {
    "id": "pi_abc123xyz789",
    "object": "payment_intent",
    "status": "PROCESSING",
    "amount": "1000.00",
    "currency": "USD",
    "type": "DELIVERY_VS_PAYMENT",
    "fiatPaymentStatus": "succeeded",
    "paymentProcessorType": "mocked_stripe",
    "paymentProcessorTxId": "ch_abc123",
    "onRampStatus": "completed",
    "onRampTxId": "or_xyz789",
    "stablecoinAmount": "1000.00",
    "stablecoinCurrency": "USDC",
    ...
  },
  "created": 1706792400,
  "updated": 1706792600
}
```

---

## Escrow Operations

### Get Escrow Order

Retrieves the escrow order associated with a payment intent.

```
GET /payment-intents/{intentId}/escrow
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Response (200 OK)

```json
{
  "id": "eo_abc123xyz789",
  "object": "escrow_order",
  "data": {
    "id": "eo_abc123xyz789",
    "paymentIntentId": "pi_abc123xyz789",
    "orderId": "12345",
    "merchantId": "merchant_abc",
    "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "buyerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    "tokenAddress": "0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8",
    "amount": "1000.00",
    "deliveryPeriod": 2592000,
    "deliveryDeadline": "1709384400",
    "expectedDeliveryHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "actualDeliveryHash": null,
    "autoReleaseOnProof": true,
    "deliveryOracle": "0x0000000000000000000000000000000000000000",
    "releaseType": "DELIVERY_PROOF",
    "timeLockUntil": null,
    "orderStatus": "PENDING",
    "settlementStatus": "NONE",
    "disputeWindow": "604800",
    "disputeRaisedAt": null,
    "disputeReason": null,
    "disputeRaisedBy": null,
    "disputeResolvedAt": null,
    "disputeResolution": null,
    "disputeResolutionTxHash": null,
    "createTxHash": "0xabcdef...",
    "releasedAt": null,
    "settlementScheduledAt": null,
    "deliveryProofs": [],
    "milestones": [],
    "settlementExecution": null,
    "createdAt": "2024-02-01T12:00:00.000Z",
    "updatedAt": "2024-02-01T12:00:00.000Z"
  }
}
```

---

### Submit Delivery Proof

Submits a delivery proof for an escrow order.

```
POST /payment-intents/{intentId}/escrow/delivery-proof
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Request Body

```json
{
  "proofHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "proofURI": "https://example.com/delivery-proofs/12345",
  "submittedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
  "submitTxHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `proofHash` | string | Yes | Hash of the delivery proof (bytes32 hex string) |
| `proofURI` | string | No | URI where the delivery proof can be accessed |
| `submittedBy` | string | Yes | Address of the entity submitting the proof |
| `submitTxHash` | string | No | Transaction hash if proof was submitted on-chain |

#### Response (200 OK)

```json
{
  "id": "dp_abc123xyz789",
  "object": "delivery_proof",
  "data": {
    "id": "dp_abc123xyz789",
    "escrowOrderId": "eo_abc123xyz789",
    "paymentIntentId": "pi_abc123xyz789",
    "proofHash": "0xabcdef...",
    "proofURI": "https://example.com/delivery-proofs/12345",
    "submittedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
    "submittedAt": "1706792600",
    "submitTxHash": "0x1234...",
    "createdAt": "2024-02-01T12:10:00.000Z"
  }
}
```

---

### Raise Dispute

Raises a dispute for an escrow order.

```
POST /payment-intents/{intentId}/escrow/dispute
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Request Body

```json
{
  "reason": "Item not delivered as described",
  "raisedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318",
  "disputeWindow": "604800"
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | Yes | Reason for the dispute |
| `raisedBy` | string | Yes | Address of the entity raising the dispute |
| `disputeWindow` | string | No | Dispute window in seconds (default: 7 days = 604800) |

#### Response (200 OK)

```json
{
  "object": "dispute",
  "status": "raised"
}
```

---

## Milestone Management

### Create Milestone

Creates a milestone for a milestone-based escrow order.

```
POST /payment-intents/{intentId}/escrow/milestones
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |

#### Request Body

```json
{
  "milestoneIndex": 0,
  "description": "Initial payment - Project kickoff",
  "amount": "500.00",
  "percentage": 50
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `milestoneIndex` | integer | Yes | Index of the milestone (0-based, must be unique per order) |
| `description` | string | No | Description of the milestone |
| `amount` | string | Yes | Amount to be released for this milestone |
| `percentage` | number | No | Percentage of total amount (0-100) |

#### Response (201 Created)

```json
{
  "id": "ms_abc123xyz789",
  "object": "milestone",
  "data": {
    "id": "ms_abc123xyz789",
    "escrowOrderId": "eo_abc123xyz789",
    "paymentIntentId": "pi_abc123xyz789",
    "milestoneIndex": 0,
    "description": "Initial payment - Project kickoff",
    "amount": "500.00",
    "percentage": 50,
    "status": "PENDING",
    "completionProof": null,
    "completionProofURI": null,
    "releasedAt": null,
    "releaseTxHash": null,
    "releasedBy": null,
    "completedAt": null,
    "completedBy": null,
    "createdAt": "2024-02-01T12:00:00.000Z",
    "updatedAt": "2024-02-01T12:00:00.000Z"
  }
}
```

---

### Complete Milestone

Completes a milestone and triggers the release of funds.

```
POST /payment-intents/{intentId}/escrow/milestones/{milestoneId}/complete
```

**Authentication:** Required (API Key)

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intentId` | string | Yes | The payment intent ID |
| `milestoneId` | string | Yes | The milestone ID |

#### Request Body

```json
{
  "completionProof": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "completionProofURI": "https://example.com/milestone-proofs/12345",
  "completedBy": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318"
}
```

#### Request Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `completionProof` | string | No | Proof of milestone completion (hash) |
| `completionProofURI` | string | No | URI where the completion proof can be accessed |
| `completedBy` | string | Yes | Address of the entity completing the milestone |

#### Response (200 OK)

```json
{
  "object": "milestone",
  "status": "completed"
}
```

---

## Data Models

### PaymentIntentEntity

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique payment intent identifier |
| `object` | string | Always "payment_intent" |
| `status` | string | Current status (see [Payment Intent Status](#payment-intent-status)) |
| `amount` | string | Payment amount as decimal string |
| `currency` | string | Currency code |
| `type` | string | Payment type |
| `description` | string | Human-readable description |
| `settlementMethod` | string | Settlement method |
| `settlementDestination` | string | Settlement destination |
| `settlementStatus` | string | Settlement status |
| `contractAddress` | string | Smart contract address |
| `transactionHash` | string | Blockchain transaction hash |
| `chainId` | number | Blockchain chain ID |
| `typedData` | object | EIP-712 typed data for signing |
| `signature` | string | Payer's signature |
| `signerAddress` | string | Payer's Ethereum address |
| `estimatedFee` | string | Estimated transaction fee |
| `estimatedDeliveryTime` | string | Estimated delivery time |
| `phases` | array | Payment processing phases |
| `metadata` | object | Custom metadata |
| `paymentUrl` | string | URL for frontend payment interface |
| `created` | number | Unix timestamp of creation |
| `updated` | number | Unix timestamp of last update |

### EscrowOrder

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique escrow order identifier |
| `paymentIntentId` | string | Associated payment intent ID |
| `orderId` | string | Contract order ID |
| `merchantId` | string | Merchant identifier |
| `contractAddress` | string | Escrow contract address |
| `buyerAddress` | string | Buyer's wallet address |
| `tokenAddress` | string | ERC-20 token address |
| `amount` | string | Order amount |
| `deliveryPeriod` | number | Delivery period in seconds |
| `deliveryDeadline` | string | Unix timestamp deadline |
| `expectedDeliveryHash` | string | Expected delivery hash (bytes32) |
| `actualDeliveryHash` | string | Actual delivery hash |
| `autoReleaseOnProof` | boolean | Auto-release on proof submission |
| `deliveryOracle` | string | Delivery oracle address |
| `releaseType` | string | Release mechanism type |
| `timeLockUntil` | string | Time lock timestamp |
| `orderStatus` | string | Order status |
| `settlementStatus` | string | Settlement status |
| `disputeWindow` | string | Dispute window in seconds |
| `disputeRaisedAt` | string | Dispute timestamp |
| `disputeReason` | string | Dispute reason |
| `disputeRaisedBy` | string | Disputer address |
| `disputeResolvedAt` | string | Resolution timestamp |
| `disputeResolution` | string | Resolution outcome |
| `createTxHash` | string | Creation transaction hash |
| `releasedAt` | string | Release timestamp |

---

## Error Handling

### Error Response Format

All errors follow a consistent format:

```json
{
  "object": "error",
  "type": "invalid_request_error",
  "code": "resource_missing",
  "message": "Payment intent not found: pi_abc123xyz789",
  "param": "intentId"
}
```

### Error Fields

| Field | Type | Description |
|-------|------|-------------|
| `object` | string | Always "error" |
| `type` | string | Always "invalid_request_error" |
| `code` | string | Error code |
| `message` | string | Human-readable error message |
| `param` | string | Parameter that caused the error (if applicable) |

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `resource_missing` | 404 | Requested resource not found |
| `forbidden` | 403 | Permission denied |
| `invalid_request_error` | 400 | Invalid request parameters |
| `payment_failed` | 400 | Payment processing failed |
| `on_ramp_failed` | 500 | On-ramp processing failed |
| `configuration_error` | 500 | Server configuration error |

---

## Status Codes & Enums

### Payment Intent Status

| Status | Description |
|--------|-------------|
| `INITIATED` | Payment intent created, awaiting signature |
| `REQUIRES_SIGNATURE` | Waiting for payer signature |
| `PAYMENT_CONFIRMED` | Payment confirmed, processing |
| `PROCESSING` | Payment is being processed |
| `SUCCEEDED` | Payment succeeded |
| `SETTLED` | Funds have been settled |
| `FINAL` | Payment is complete |
| `CANCELED` | Payment was canceled |
| `REQUIRES_ACTION` | Additional action required |

### Settlement Status

| Status | Description |
|--------|-------------|
| `PENDING` | Settlement pending |
| `IN_PROGRESS` | Settlement in progress |
| `COMPLETED` | Settlement completed |
| `FAILED` | Settlement failed |

### Escrow Order Status

| Status | Description |
|--------|-------------|
| `PENDING` | Order created, awaiting action |
| `SHIPPED` | Goods have been shipped |
| `DELIVERED` | Goods have been delivered |
| `COMPLETED` | Order completed successfully |
| `CANCELLED` | Order was cancelled |
| `DISPUTED` | Order is under dispute |

### Escrow Settlement Status

| Status | Description |
|--------|-------------|
| `NONE` | No settlement scheduled |
| `SCHEDULED` | Settlement scheduled |
| `EXECUTED` | Settlement executed |
| `CONFIRMED` | Settlement confirmed |
| `CANCELLED` | Settlement cancelled |

### Release Type

| Type | Description |
|------|-------------|
| `TIME_LOCKED` | Funds released after time period |
| `MILESTONE_LOCKED` | Funds released per milestone |
| `DELIVERY_PROOF` | Funds released on delivery proof |
| `AUTO_RELEASE` | Automatic release on proof submission |

### Milestone Status

| Status | Description |
|--------|-------------|
| `PENDING` | Milestone not yet completed |
| `COMPLETED` | Milestone marked as complete |
| `RELEASED` | Milestone funds released |
| `CANCELLED` | Milestone cancelled |

### Dispute Resolution

| Resolution | Description |
|------------|-------------|
| `MERCHANT_WON` | Dispute resolved in favor of merchant |
| `BUYER_WON` | Dispute resolved in favor of buyer |
| `PARTIAL_REFUND` | Partial refund issued |

### Payment Phases

| Phase | Description |
|-------|-------------|
| `SIGNATURE_VERIFICATION` | Verifying payer signature |
| `ESCROW_LOCKED` | Funds locked in escrow |
| `AWAITING_DELIVERY_PROOF` | Waiting for delivery proof |
| `BLOCKCHAIN_CONFIRMATION` | Awaiting blockchain confirmation |
| `SETTLEMENT` | Settling funds to destination |

### Phase Status

| Status | Description |
|--------|-------------|
| `IN_PROGRESS` | Phase is currently in progress |
| `COMPLETED` | Phase completed successfully |
| `FAILED` | Phase failed |

---

## Postman Collection Import

To import this API into Postman:

1. Create a new Postman Collection
2. Set the base URL variable: `{{baseUrl}}` = `http://localhost:3000/api/v1`
3. Set the API Key variable: `{{apiKey}}` = `sk_test_your_api_key`
4. Add the following headers to all authenticated requests:
   - `X-API-Key`: `{{apiKey}}`
   - `Content-Type`: `application/json`

### Environment Variables

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `baseUrl` | `http://localhost:3000/api/v1` | API base URL |
| `apiKey` | `sk_test_abc123xyz789` | Your merchant API key |
| `intentId` | `pi_abc123xyz789` | Current payment intent ID |
| `milestoneId` | `ms_abc123xyz789` | Current milestone ID |

---

## Changelog

### Version 0.1.0

- Initial API release
- Payment Intent CRUD operations
- Escrow management
- Milestone-based payments
- Web2 (card) and Web3 (wallet) payment flows
- Delivery proof submission
- Dispute management
