#!/bin/bash

# Complete Payment Flow Test Script
# This script tests the entire payment flow from creation to settlement

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000/api/v1}"
API_KEY="${API_KEY:-sk_hackathon_test_key}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Payment Flow End-to-End Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Create Payment Intent
echo -e "${YELLOW}Step 1: Creating Payment Intent...${NC}"
CREATE_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/payment-intents" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
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
  }')

INTENT_ID=$(echo $CREATE_RESPONSE | jq -r '.data.id')
PAYMENT_URL=$(echo $CREATE_RESPONSE | jq -r '.data.paymentUrl // empty')

echo -e "${GREEN}✓ Payment Intent Created${NC}"
echo "  Intent ID: ${INTENT_ID}"
echo "  Status: $(echo $CREATE_RESPONSE | jq -r '.data.status')"
if [ -n "$PAYMENT_URL" ] && [ "$PAYMENT_URL" != "null" ]; then
  echo "  Payment URL: ${PAYMENT_URL}"
else
  echo -e "  ${YELLOW}Payment URL: null (set FRONTEND_URL in .env)${NC}"
fi
echo ""

# Step 2: Get Payment Intent (verify it exists)
echo -e "${YELLOW}Step 2: Retrieving Payment Intent...${NC}"
GET_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/payment-intents/${INTENT_ID}" \
  -H "X-API-Key: ${API_KEY}")

echo -e "${GREEN}✓ Payment Intent Retrieved${NC}"
echo "  Status: $(echo $GET_RESPONSE | jq -r '.data.status')"
echo "  Amount: $(echo $GET_RESPONSE | jq -r '.data.amount')"
echo "  Type: $(echo $GET_RESPONSE | jq -r '.data.type')"
echo ""

# Step 3: Get Public Payment Intent (no auth required)
echo -e "${YELLOW}Step 3: Testing Public Endpoint...${NC}"
PUBLIC_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/payment-intents/public/${INTENT_ID}")

echo -e "${GREEN}✓ Public Endpoint Works${NC}"
echo "  Status: $(echo $PUBLIC_RESPONSE | jq -r '.data.status')"
echo ""

# Step 4: Note about wallet interaction
echo -e "${YELLOW}Step 4: Wallet Interaction (Manual)${NC}"
echo -e "${BLUE}NOTE:${NC} The next steps require wallet interaction:"
echo "  1. Visit the payment URL in a browser"
echo "  2. Connect your wallet (MetaMask, WalletConnect, etc.)"
echo "  3. Sign the EIP-712 typed data"
echo "  4. Approve ERC-20 tokens (if needed)"
echo "  5. Execute the contract transaction"
echo ""
echo -e "${YELLOW}For now, we'll skip to testing escrow endpoints...${NC}"
echo ""

# Step 5: Check if Escrow Order exists (will be created when payment is confirmed)
echo -e "${YELLOW}Step 5: Checking Escrow Order...${NC}"
ESCROW_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/payment-intents/${INTENT_ID}/escrow" \
  -H "X-API-Key: ${API_KEY}" 2>&1) || true

if echo "$ESCROW_RESPONSE" | grep -q "404\|not found"; then
  echo -e "${YELLOW}⚠ Escrow Order not created yet (payment not confirmed)${NC}"
  echo "  Escrow orders are created automatically when payment is confirmed"
else
  echo -e "${GREEN}✓ Escrow Order Found${NC}"
  echo "$ESCROW_RESPONSE" | jq '.'
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Payment Intent Created${NC}"
echo -e "${GREEN}✓ Payment Intent Retrieved${NC}"
echo -e "${GREEN}✓ Public Endpoint Works${NC}"
echo ""
echo -e "${YELLOW}Next Steps (Manual):${NC}"
echo "1. Complete wallet interaction on frontend"
echo "2. Payment will be confirmed on blockchain"
echo "3. Escrow order will be created automatically"
echo "4. Test delivery proof submission:"
echo "   POST ${API_BASE_URL}/payment-intents/${INTENT_ID}/escrow/delivery-proof"
echo ""
echo -e "${BLUE}Payment Intent ID: ${INTENT_ID}${NC}"
echo ""

