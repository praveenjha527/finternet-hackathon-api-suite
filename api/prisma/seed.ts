import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

/**
 * Generate a random API key with the given prefix.
 * Format: {prefix}{32 random hex characters}
 */
function generateApiKey(prefix: string): string {
  const randomBytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `${prefix}${randomBytes}`;
}

async function main() {
  console.log('🌱 Seeding merchants...');

  // Get contract addresses from environment variables (fallback for merchants without specific addresses)
  const defaultDvpAddress = process.env.DvP_CONTRACT_ADDRESS || null;
  const defaultConsentedPullAddress = process.env.CONSENTED_PULL_CONTRACT_ADDRESS || null;

  // Hackathon merchants (4-5 merchants)
  // Each merchant can have their own contract addresses, or use env vars as fallback
  const hackathonMerchants = [
    {
      name: 'Acme Corp',
      apiKeyPrefix: 'sk_hackathon_',
      dvpContractAddress: defaultDvpAddress,
      consentedPullContractAddress: defaultConsentedPullAddress,
    },
    {
      name: 'Widget Inc',
      apiKeyPrefix: 'sk_hackathon_',
      dvpContractAddress: defaultDvpAddress,
      consentedPullContractAddress: defaultConsentedPullAddress,
    },
    {
      name: 'TechStart',
      apiKeyPrefix: 'sk_hackathon_',
      dvpContractAddress: defaultDvpAddress,
      consentedPullContractAddress: defaultConsentedPullAddress,
    },
    {
      name: 'GlobalPay',
      apiKeyPrefix: 'sk_hackathon_',
      dvpContractAddress: defaultDvpAddress,
      consentedPullContractAddress: defaultConsentedPullAddress,
    },
  ];

  // Test merchant
  const testMerchant = {
    name: 'Test Merchant',
    apiKeyPrefix: 'sk_test_',
    dvpContractAddress: defaultDvpAddress,
    consentedPullContractAddress: defaultConsentedPullAddress,
  };

  // Live merchant (example)
  const liveMerchant = {
    name: 'Production Merchant',
    apiKeyPrefix: 'sk_live_',
    dvpContractAddress: defaultDvpAddress,
    consentedPullContractAddress: defaultConsentedPullAddress,
  };

  const allMerchants = [...hackathonMerchants, testMerchant, liveMerchant];

  for (const merchantData of allMerchants) {
    const apiKey = generateApiKey(merchantData.apiKeyPrefix);

    const existing = await prisma.merchant.findUnique({
      where: { apiKey },
    });

    if (existing) {
      console.log(`✓ Merchant "${merchantData.name}" already exists with API key: ${apiKey}`);
      // Update contract addresses if they changed
      const existingWithContracts = existing as unknown as {
        dvpContractAddress: string | null;
        consentedPullContractAddress: string | null;
      };
      if (
        existingWithContracts.dvpContractAddress !== merchantData.dvpContractAddress ||
        existingWithContracts.consentedPullContractAddress !== merchantData.consentedPullContractAddress
      ) {
        await prisma.merchant.update({
          where: { id: existing.id },
          data: {
            dvpContractAddress: merchantData.dvpContractAddress,
            consentedPullContractAddress: merchantData.consentedPullContractAddress,
          } as any, // Type assertion needed until Prisma Client is regenerated
        });
        console.log(`  → Updated contract addresses for "${merchantData.name}"`);
      }
      continue;
    }

    const created = await prisma.merchant.upsert({
      where: { apiKey },
      update: {
        dvpContractAddress: merchantData.dvpContractAddress,
        consentedPullContractAddress: merchantData.consentedPullContractAddress,
      } as any, // Type assertion needed until Prisma Client is regenerated
      create: {
        name: merchantData.name,
        apiKey,
        isActive: true,
        dvpContractAddress: merchantData.dvpContractAddress,
        consentedPullContractAddress: merchantData.consentedPullContractAddress,
      } as any, // Type assertion needed until Prisma Client is regenerated
    });

    console.log(`✓ Created merchant "${created.name}" with API key: ${created.apiKey}`);
  }

  // Create fiat accounts for all merchants
  console.log('\n📊 Creating fiat accounts for merchants...\n');

  const existingMerchants = await prisma.merchant.findMany({
    orderBy: { createdAt: 'asc' },
  });

  for (const merchant of existingMerchants) {
    const existingAccount = await (prisma as any).merchantFiatAccount.findUnique({
      where: { merchantId: merchant.id },
    });

    if (!existingAccount) {
      // Generate simulated account details
      const accountNumber = Array.from({ length: 10 }, () =>
        Math.floor(Math.random() * 10),
      ).join('');
      const routingNumber = Array.from({ length: 9 }, () =>
        Math.floor(Math.random() * 10),
      ).join('');

      // Give hackathon merchants some initial balance for testing
      const initialBalance =
        merchant.apiKey.startsWith('sk_hackathon_') ? '10000.00' : '0.00';

      await (prisma as any).merchantFiatAccount.create({
        data: {
          merchantId: merchant.id,
          currency: 'USD',
          availableBalance: initialBalance,
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

      console.log(
        `  ✓ Created fiat account for ${merchant.name} (Balance: $${initialBalance})`,
      );
    }
  }

  console.log('\n✅ Seeding complete!');
  console.log('\n📋 Merchant API Keys:');
  existingMerchants.forEach((m) => {
    console.log(`  - ${m.name}: ${m.apiKey}`);
  });
}

main()
  .catch((e) => {
    console.error('❌ Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

