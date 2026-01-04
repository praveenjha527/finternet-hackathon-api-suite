#!/bin/bash

# Quick Test Script - Complete Payment Flow
# Usage: ./scripts/quick-test.sh [API_KEY]

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

API_BASE_URL="${API_BASE_URL:-http://localhost:3000/api/v1}"
API_KEY="${1:-${API_KEY:-}}"

if [ -z "$API_KEY" ]; then
  echo -e "${RED}Error: API Key required${NC}"
  echo "Usage: $0 <API_KEY>"
  echo ""
  echo "To get an API key:"
  echo "  1. Run: bun run prisma:seed"
  echo "  2. Copy the API key from console output"
  echo "  3. Or check your database: SELECT \"apiKey\" FROM \"Merchant\" LIMIT 1;"
  exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Complete Payment Flow Test          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Step 1: Create Payment Intent
echo -e "${CYAN}[1/7]${NC} ${YELLOW}Creating Payment Intent...${NC}"
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/payment-intents" \
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

HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -n1)
BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "201" ]; then
  echo -e "${RED}✗ Failed (HTTP $HTTP_CODE)${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  exit 1
fi

INTENT_ID=$(echo "$BODY" | jq -r '.data.id')
PAYMENT_URL=$(echo "$BODY" | jq -r '.data.paymentUrl // empty')
STATUS=$(echo "$BODY" | jq -r '.data.status')

echo -e "${GREEN}✓ Created${NC} Intent: ${CYAN}${INTENT_ID}${NC}"
echo -e "  Status: ${GREEN}${STATUS}${NC}"
if [ -n "$PAYMENT_URL" ] && [ "$PAYMENT_URL" != "null" ]; then
  echo -e "  Payment URL: ${CYAN}${PAYMENT_URL}${NC}"
fi
echo ""

# Step 2: Get Payment Intent
echo -e "${CYAN}[2/7]${NC} ${YELLOW}Retrieving Payment Intent...${NC}"
GET_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/payment-intents/${INTENT_ID}" \
  -H "X-API-Key: ${API_KEY}")

HTTP_CODE=$(echo "$GET_RESPONSE" | tail -n1)
BODY=$(echo "$GET_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${RED}✗ Failed (HTTP $HTTP_CODE)${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Retrieved${NC}"
echo "  Amount: $(echo "$BODY" | jq -r '.data.amount')"
echo "  Type: $(echo "$BODY" | jq -r '.data.type')"
echo ""

# Step 3: Public Endpoint
echo -e "${CYAN}[3/7]${NC} ${YELLOW}Testing Public Endpoint...${NC}"
PUBLIC_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/payment-intents/public/${INTENT_ID}")

HTTP_CODE=$(echo "$PUBLIC_RESPONSE" | tail -n1)
BODY=$(echo "$PUBLIC_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${RED}✗ Failed (HTTP $HTTP_CODE)${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Public Endpoint Works${NC}"
echo ""

# Step 4: Check Escrow Order (will fail if payment not confirmed)
echo -e "${CYAN}[4/7]${NC} ${YELLOW}Checking Escrow Order...${NC}"
ESCROW_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/payment-intents/${INTENT_ID}/escrow" \
  -H "X-API-Key: ${API_KEY}" 2>&1) || true

HTTP_CODE=$(echo "$ESCROW_RESPONSE" | tail -n1)
BODY=$(echo "$ESCROW_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" == "404" ]; then
  echo -e "${YELLOW}⚠ Not Created Yet${NC} (payment must be confirmed first)"
  echo "  Escrow orders are created automatically when payment is confirmed"
else
  echo -e "${GREEN}✓ Escrow Order Found${NC}"
  echo "  Order ID: $(echo "$BODY" | jq -r '.data.id')"
  echo "  Status: $(echo "$BODY" | jq -r '.data.orderStatus')"
fi
echo ""

# Step 5: Summary
echo -e "${CYAN}[5/7]${NC} ${YELLOW}Test Summary${NC}"
echo -e "${GREEN}✓ Payment Intent Created${NC}"
echo -e "${GREEN}✓ Payment Intent Retrieved${NC}"
echo -e "${GREEN}✓ Public Endpoint Works${NC}"
echo ""

# Step 6: Next Steps
echo -e "${CYAN}[6/7]${NC} ${YELLOW}Next Steps (Manual):${NC}"
echo ""
echo "1. ${CYAN}Complete Wallet Interaction${NC}:"
if [ -n "$PAYMENT_URL" ] && [ "$PAYMENT_URL" != "null" ]; then
  echo "   Visit: ${PAYMENT_URL}"
else
  echo "   (Set FRONTEND_URL in .env to get payment URL)"
fi
echo "   - Connect wallet"
echo "   - Sign EIP-712 data"
echo "   - Approve tokens (if needed)"
echo "   - Execute contract transaction"
echo ""
echo "2. ${CYAN}Check Payment Status${NC}:"
echo "   curl -X GET \"${API_BASE_URL}/payment-intents/${INTENT_ID}\" \\"
echo "     -H \"X-API-Key: ${API_KEY}\" | jq '.data.status'"
echo ""
echo "3. ${CYAN}After Payment Confirmed${NC}:"
echo "   - Escrow order will be created automatically"
echo "   - Test delivery proof submission"
echo "   - Check settlement processing"
echo ""

# Step 7: Save Intent ID
echo -e "${CYAN}[7/7]${NC} ${YELLOW}Saved for Reference${NC}"
echo ""
echo -e "${BLUE}Payment Intent ID:${NC} ${CYAN}${INTENT_ID}${NC}"
echo ""
echo -e "${GREEN}To continue testing:${NC}"
echo "export INTENT_ID=\"${INTENT_ID}\""
echo "export API_KEY=\"${API_KEY}\""
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Test Complete!                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"

