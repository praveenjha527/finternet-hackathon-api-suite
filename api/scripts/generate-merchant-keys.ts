#!/usr/bin/env bun

/**
 * Generate 70 hackathon merchants and API keys, then dump keys to Excel.
 * Key format: sk_hackathon_<32 hex chars> (same as seed.ts).
 *
 * Usage: bun run scripts/generate-merchant-keys.ts
 *        or: bun run generate:merchant-keys
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import dotenv from 'dotenv';
import { registerMerchantOnChain } from '../src/modules/auth/utils/merchant-registration.util';

dotenv.config();

const prisma = new PrismaClient();

const API_KEY_PREFIX = 'sk_hackathon_';
const DEFAULT_MERCHANT_ADDRESS = '0x5D478B369769183F05b70bb7a609751c419b4c04';
const MERCHANT_COUNT = 70;

/**
 * Generate a random API key with the given prefix.
 * Format: {prefix}{32 random hex characters} (same as seed.ts)
 */
function generateApiKey(prefix: string): string {
  const randomBytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `${prefix}${randomBytes}`;
}

async function main() {
  console.log(`🔑 Generating ${MERCHANT_COUNT} merchants with API keys (format: ${API_KEY_PREFIX}...)...\n`);

  const defaultDvpAddress = process.env.DvP_CONTRACT_ADDRESS || null;
  const defaultConsentedPullAddress = process.env.CONSENTED_PULL_CONTRACT_ADDRESS || null;

  // Check if merchant registration should be done on-chain (same as seed)
  const shouldRegisterOnChain = !!(
    process.env.DvP_CONTRACT_ADDRESS &&
    process.env.PRIVATE_KEY &&
    process.env.SEPOLIA_RPC_URL
  );

  if (shouldRegisterOnChain) {
    console.log('📝 Merchant on-chain registration is enabled\n');
  } else {
    console.log('⚠️  Merchant on-chain registration is disabled (set DvP_CONTRACT_ADDRESS, PRIVATE_KEY, SEPOLIA_RPC_URL to enable)\n');
  }

  // Find next available contract merchant ID
  const existing = await prisma.merchant.findMany({
    where: { contractMerchantId: { not: null } },
    select: { contractMerchantId: true },
  });
  const maxId = existing.reduce((max, m) => {
    const id = m.contractMerchantId ? parseInt(m.contractMerchantId, 10) : 0;
    return Number.isNaN(id) ? max : Math.max(max, id);
  }, 0);
  let nextContractId = maxId + 1;

  const keys: string[] = [];
  const created: { name: string; apiKey: string }[] = [];
  const merchantAddress = DEFAULT_MERCHANT_ADDRESS;

  for (let i = 1; i <= MERCHANT_COUNT; i++) {
    let apiKey = generateApiKey(API_KEY_PREFIX);
    while (await prisma.merchant.findUnique({ where: { apiKey } })) {
      apiKey = generateApiKey(API_KEY_PREFIX);
    }

    const name = `Hackathon Merchant ${i}`;
    const contractMerchantId = String(nextContractId++);

    // Register merchant on-chain if enabled (same as seed)
    if (shouldRegisterOnChain && defaultDvpAddress) {
      try {
        const registrationResult = await registerMerchantOnChain(
          {
            contractAddress: defaultDvpAddress,
            privateKey: process.env.PRIVATE_KEY!,
            rpcUrl: process.env.SEPOLIA_RPC_URL!,
          },
          {
            merchantId: contractMerchantId,
            merchantAddress,
          },
        );

        if (registrationResult.success) {
          console.log(`  ✓ Registered merchant "${name}" on-chain (ID: ${contractMerchantId}, TX: ${registrationResult.transactionHash})`);
        } else {
          console.log(`  ⚠️  Failed to register merchant "${name}" on-chain: ${registrationResult.error}`);
        }
      } catch (error) {
        console.error(`  ❌ Error registering merchant "${name}" on-chain:`, error);
      }
    }

    await prisma.merchant.upsert({
      where: { apiKey },
      update: {},
      create: {
        name,
        apiKey,
        isActive: true,
        dvpContractAddress: defaultDvpAddress,
        consentedPullContractAddress: defaultConsentedPullAddress,
        contractMerchantId,
        merchantAddress,
      } as any,
    });

    keys.push(apiKey);
    created.push({ name, apiKey });
    if (i % 10 === 0) console.log(`  Created ${i}/${MERCHANT_COUNT} merchants...`);
  }

  // Optional: create fiat accounts for new merchants (like seed)
  for (const m of created) {
    const merchant = await prisma.merchant.findUnique({
      where: { apiKey: m.apiKey },
      include: { fiatAccount: true },
    });
    if (merchant && !merchant.fiatAccount) {
      const accountNumber = Array.from({ length: 10 }, () =>
        Math.floor(Math.random() * 10),
      ).join('');
      const routingNumber = Array.from({ length: 9 }, () =>
        Math.floor(Math.random() * 10),
      ).join('');
      await (prisma as any).merchantFiatAccount.create({
        data: {
          merchantId: merchant.id,
          currency: 'USD',
          availableBalance: '10000.00',
          pendingBalance: '0.00',
          reservedBalance: '0.00',
          accountNumber,
          routingNumber,
          bankName: 'Simulated Bank',
          accountHolderName: merchant.name,
          country: 'US',
          isActive: true,
        },
      });
    }
  }

  // Build Excel: one column "API KEY", one row per key
  const wsData = [['API KEY'], ...keys.map((k) => [k])];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'API Keys');

  const outDir = path.resolve(process.cwd(), 'scripts');
  const outPath = path.join(outDir, 'merchant-api-keys.xlsx');
  XLSX.writeFile(wb, outPath);

  console.log(`\n✅ Created ${MERCHANT_COUNT} merchants.`);
  console.log(`📄 API keys written to: ${outPath}`);
  console.log(`   Header: API KEY, format: ${API_KEY_PREFIX}<32 hex>`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
