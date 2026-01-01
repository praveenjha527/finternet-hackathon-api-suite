# Finternet Payment Gateway API

A production-ready payment gateway API built with NestJS, Prisma, and PostgreSQL. This API provides trustless payment infrastructure for programmable money movement, supporting multi-tenant merchants, blockchain integration, and off-ramp settlement.

## 🚀 Features

### Core Capabilities
- **Multi-Tenant Architecture**: Isolated merchant accounts with API key authentication
- **Payment Intent Lifecycle**: State-based payment processing with full lifecycle management
- **Blockchain Integration**: Support for Ethereum Sepolia with EIP-712 signature verification
- **Off-Ramp Settlement**: Mock settlement processing with configurable delays
- **Comprehensive Audit Trail**: Complete money trail logging from on-chain to off-ramp
- **Event-Driven Architecture**: Decoupled services with event emission for extensibility
- **Structured Logging**: JSON-based logging with Winston for observability

### Payment Types
- **DELIVERY_VS_PAYMENT (DvP)**: Escrow-based payments with delivery verification
- **CONSENTED_PULL**: Standard payment intent with payer consent

### Settlement Methods
- **OFF_RAMP_TO_RTP**: Real-Time Payment settlement (mock)
- **OFF_RAMP_TO_BANK**: Bank transfer settlement (mock)
- **OFF_RAMP_MOCK**: Configurable mock settlement for testing

## 📋 Tech Stack

- **Runtime**: Node.js with Bun
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL with Prisma ORM
- **Blockchain**: Ethereum (Sepolia testnet), ethers.js v6
- **Authentication**: API Key-based (Stripe-like)
- **Logging**: Winston (JSON format)
- **Events**: NestJS EventEmitter
- **Validation**: class-validator, class-transformer
- **Documentation**: Swagger/OpenAPI

## 🔧 Prerequisites

- **Bun** (v1.3.5+) - [Installation Guide](https://bun.sh/docs/installation)
- **PostgreSQL** (v12+) - Running database instance
- **Node.js** (v18+) - If using npm fallback (not required with Bun)

## 📦 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd finternet_hackathon_api
```

### 2. Install Dependencies

```bash
cd api
bun install
```

### 3. Configure Environment

Create a `.env` file in the `api/` directory:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/finternet_pg?schema=public"

# Server
PORT=3000
NODE_ENV=development

# Off-Ramp Mock (optional, defaults to 10000ms)
OFF_RAMP_MOCK_DELAY=10000

# Blockchain (optional, falls back to mock mode if not set)
DvP_CONTRACT_ADDRESS=0x...
CONSENTED_PULL_CONTRACT_ADDRESS=0x...

# Logging (optional, defaults to 'info')
LOG_LEVEL=info
```

### 4. Setup Database

```bash
# Run migrations
bunx prisma migrate dev --name init

# Generate Prisma Client
bunx prisma generate

# Seed merchants with API keys
bun run prisma:seed
```

The seed script creates pre-configured merchants with API keys:
- 4 Hackathon merchants (prefix: `sk_hackathon_*`)
- 1 Test merchant (prefix: `sk_test_*`)
- 1 Live merchant (prefix: `sk_live_*`)

**Note**: API keys are printed to console after seeding. Save them securely!

### 5. Start Development Server

```bash
bun run start:dev
```

The API will be available at:
- **Base URL**: `http://localhost:3000/api/v1`
- **Swagger Docs**: `http://localhost:3000/api/docs`

## 🔑 Authentication

All API endpoints require authentication via API Key.

### API Key Format

API keys follow the pattern: `{prefix}_{uuid}`

- **Hackathon**: `sk_hackathon_*` (for hackathon participants)
- **Test**: `sk_test_*` (for testing)
- **Live**: `sk_live_*` (for production)

### Using API Keys

#### Header Method (Recommended)
```bash
curl -H "X-API-Key: sk_hackathon_<your-key>" \
  http://localhost:3000/api/v1/payment-intents
```

#### Authorization Header (Alternative)
```bash
curl -H "Authorization: Bearer sk_hackathon_<your-key>" \
  http://localhost:3000/api/v1/payment-intents
```

### Merchant Isolation

Each merchant can only access their own payment intents. Attempting to access another merchant's payment intent will return a `403 Forbidden` error.

## 📚 API Documentation

### Base URL

```
http://localhost:3000/api/v1
```

### Endpoints

#### 1. Create Payment Intent

**POST** `/payment-intents`

Creates a new payment intent for the authenticated merchant.

**Request Body:**
```json
{
  "amount": "1000.00",
  "currency": "USDC",
  "type": "DELIVERY_VS_PAYMENT",
  "settlementMethod": "OFF_RAMP_MOCK",
  "settlementDestination": "9876543210",
  "description": "Order #ORD-123",
  "metadata": {
    "orderId": "ORD-123",
    "customerId": "CUST-456"
  }
}
```

**Response:**
```json
{
  "id": "intent_...",
  "object": "payment_intent",
  "status": "INITIATED",
  "data": {
    "id": "intent_...",
    "status": "INITIATED",
    "amount": "1000.00",
    "currency": "USDC",
    "typedData": { ... },
    "phases": [
      { "phase": "SIGNATURE_VERIFICATION", "status": "IN_PROGRESS" }
    ],
    ...
  },
  "created": 1234567890,
  "updated": 1234567890
}
```

#### 2. Get Payment Intent

**GET** `/payment-intents/:intentId`

Retrieves a payment intent by ID (must belong to authenticated merchant).

**Response:** Same structure as create response, with current status and phases.

#### 3. Confirm Payment Intent

**POST** `/payment-intents/:intentId/confirm`

Confirms a payment intent with EIP-712 signature and payer address.

**Request Body:**
```json
{
  "signature": "0x1234567890abcdef...",
  "payerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f42318"
}
```

**Response:** Updated payment intent with blockchain transaction details.

### Payment Intent Statuses

| Status | Description |
|--------|-------------|
| `INITIATED` | Payment intent created, awaiting signature |
| `REQUIRES_SIGNATURE` | Signature required to proceed |
| `PROCESSING` | Blockchain transaction submitted, awaiting confirmation |
| `SUCCEEDED` | Blockchain transaction confirmed (5+ confirmations) |
| `SETTLED` | Off-ramp settlement completed |
| `FINAL` | Payment fully completed |
| `CANCELED` | Payment canceled |
| `REQUIRES_ACTION` | Payment requires manual intervention |

### Payment Phases

Payment intents track progress through multiple phases:

- **SIGNATURE_VERIFICATION**: EIP-712 signature verification
- **BLOCKCHAIN_CONFIRMATION**: On-chain transaction confirmation
- **ESCROW_LOCKED**: Funds locked in escrow (DvP only)
- **AWAITING_DELIVERY_PROOF**: Waiting for delivery confirmation (DvP only)
- **SETTLEMENT**: Off-ramp settlement processing

Each phase has a status: `IN_PROGRESS`, `COMPLETED`, or `FAILED`.

### Settlement Statuses

| Status | Description |
|--------|-------------|
| `PENDING` | Settlement not yet started |
| `IN_PROGRESS` | Settlement processing |
| `COMPLETED` | Settlement successful |
| `FAILED` | Settlement failed |

## 🗄️ Database Schema

### Models

#### Merchant
Stores merchant accounts with API keys.

```prisma
model Merchant {
  id        String   @id @default(uuid())
  name      String
  apiKey    String   @unique
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  paymentIntents PaymentIntent[]
  auditLogs      AuditLog[]
}
```

#### PaymentIntent
Core payment intent entity with full lifecycle tracking.

```prisma
model PaymentIntent {
  id                    String   @id
  merchantId            String
  status                String
  amount                String
  currency              String
  type                  String
  settlementMethod      String
  settlementDestination String
  settlementStatus      String?
  contractAddress       String?
  transactionHash       String?
  chainId               Int?
  typedData             Json?
  signature             String?
  signerAddress         String?
  phases                Json?
  metadata              Json?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  merchant   Merchant   @relation(...)
  auditLogs  AuditLog[]
}
```

#### AuditLog
Comprehensive audit trail for money movements and lifecycle events.

```prisma
model AuditLog {
  id                    String   @id @default(uuid())
  eventType             String
  category              String
  merchantId            String?
  paymentIntentId       String?
  amount                String?
  currency              String?
  blockchainTxHash      String?
  blockchainTxStatus    String?
  settlementMethod      String?
  settlementDestination String?
  settlementTxId        String?
  settlementStatus      String?
  fromStatus            String?
  toStatus              String?
  phase                 String?
  phaseStatus           String?
  actorType             String?
  actorId               String?
  metadata              Json?
  createdAt             DateTime @default(now())
  
  merchant      Merchant?      @relation(...)
  paymentIntent PaymentIntent? @relation(...)
}
```

All models are indexed for optimal query performance.

## 🏗️ Architecture

### Service Layer

- **IntentService**: Core payment intent logic, state machine integration, event emission
- **BlockchainService**: Ethereum blockchain interactions (transaction submission, confirmation tracking)
- **SettlementService**: Off-ramp settlement execution (mock implementation)
- **RoutingService**: Settlement method validation and routing
- **ComplianceService**: Compliance checks (currently mock)
- **AuditService**: Audit trail logging
- **PaymentStateMachineService**: State transition validation
- **PaymentEventService**: Event emission for payment lifecycle

### Event System

The API uses NestJS EventEmitter for decoupled event handling:

- `payment_intent.created`
- `payment_intent.status_changed`
- `payment_intent.blockchain_tx_submitted`
- `payment_intent.blockchain_tx_confirmed`
- `payment_intent.settlement_initiated`
- `payment_intent.settlement_completed`

Events are logged and can be extended for webhooks, notifications, or analytics.

### State Machine

Payment intents follow a strict state machine to ensure valid transitions:

```
INITIATED → REQUIRES_SIGNATURE → PROCESSING → SUCCEEDED → SETTLED → FINAL
                     ↓                ↓            ↓
                 CANCELED        CANCELED    REQUIRES_ACTION
```

Invalid transitions throw `BadRequestException`.

## 🔍 Observability

### Logging

All logs are structured JSON format via Winston:

- **HTTP Request Logging**: Middleware logs all requests/responses with merchant context
- **Application Logging**: Service-level logs with appropriate log levels
- **Event Logging**: Payment lifecycle events logged for tracing

Log levels: `error`, `warn`, `info`, `debug` (configurable via `LOG_LEVEL` env var)

### Audit Trail

All money movements are logged to `AuditLog` table:

- Payment intent creation
- Blockchain transaction submission/confirmation
- Settlement initiation/completion
- Status changes
- Phase transitions

Each audit log includes:
- Event type and category
- Money amounts and currency
- Blockchain transaction details (hash, status, block number)
- Settlement details (method, destination, transaction ID)
- Actor information (merchant, payer, system)
- Status transitions and phases

## 🧪 Development

### Available Scripts

```bash
# Development
bun run start:dev          # Start with hot-reload
bun run start              # Start production build
bun run start:prod         # Start production server

# Database
bunx prisma migrate dev    # Run migrations
bunx prisma generate       # Generate Prisma Client
bun run prisma:seed        # Seed merchants

# Code Quality
bun run lint               # Run ESLint
bun run format             # Format code with Prettier
bun run test               # Run unit tests
bun run test:e2e           # Run e2e tests
bun run build              # Build for production
```

### Project Structure

```
api/
├── src/
│   ├── modules/
│   │   ├── auth/              # Authentication module
│   │   │   ├── guards/        # API Key guard
│   │   │   ├── decorators/    # @CurrentMerchant decorator
│   │   │   └── merchant.service.ts
│   │   └── payments/          # Payment module
│   │       ├── dto/           # Data Transfer Objects
│   │       ├── entities/      # Type definitions
│   │       ├── events/        # Event definitions
│   │       ├── listeners/     # Event listeners
│   │       └── services/      # Business logic services
│   ├── common/
│   │   ├── exceptions.ts      # Custom exceptions
│   │   ├── filters/           # Exception filters
│   │   ├── logger/            # Winston configuration
│   │   ├── middleware/        # HTTP logging middleware
│   │   └── responses.ts       # Response types
│   ├── config/                # Configuration
│   ├── prisma/                # Prisma service
│   ├── schema/                # EIP-712 schema
│   ├── app.module.ts          # Root module
│   └── main.ts                # Application entry point
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # Migration files
│   └── seed.ts                # Seed script
├── test/                      # E2E tests
└── package.json
```

## 🔒 Security Considerations

- **API Key Authentication**: All endpoints protected by API key validation
- **Merchant Isolation**: Merchants can only access their own resources
- **EIP-712 Signatures**: Cryptographically verified signatures for payment confirmation
- **Input Validation**: All inputs validated using class-validator
- **SQL Injection Protection**: Prisma ORM prevents SQL injection
- **Type Safety**: Full TypeScript coverage for type safety

## 📝 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `PORT` | Server port | No | `3000` |
| `NODE_ENV` | Environment (development/production) | No | `development` |
| `OFF_RAMP_MOCK_DELAY` | Mock settlement delay in ms | No | `10000` |
| `LOG_LEVEL` | Winston log level | No | `info` |
| `DvP_CONTRACT_ADDRESS` | DvP contract address | No | Mock mode |
| `CONSENTED_PULL_CONTRACT_ADDRESS` | Consented Pull contract address | No | Mock mode |

## 🤝 Contributing

This is a hackathon project. For production use, consider:

1. Adding rate limiting
2. Implementing webhook system
3. Adding retry mechanisms for blockchain transactions
4. Implementing real off-ramp integrations
5. Adding monitoring and alerting
6. Implementing proper secret management
7. Adding comprehensive test coverage

## 📄 License

UNLICENSED - Hackathon project

## 🔗 Additional Resources

- **Swagger Documentation**: Available at `/api/docs` when server is running
- **Prisma Studio**: Run `bunx prisma studio` to explore database
- **Bun Documentation**: https://bun.sh/docs
- **NestJS Documentation**: https://docs.nestjs.com

---

Built for the Finternet Hackathon 🚀
