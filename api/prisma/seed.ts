import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { registerMerchantOnChain } from '../src/modules/auth/utils/merchant-registration.util';
dotenv.config();

const prisma = new PrismaClient();

// Default merchant address for all merchants (for hackathon/demo)
const DEFAULT_MERCHANT_ADDRESS = '0x5D478B369769183F05b70bb7a609751c419b4c04';

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

  // Check if merchant registration should be done on-chain
  const shouldRegisterOnChain = !!(
    process.env.DvP_CONTRACT_ADDRESS &&
    process.env.PRIVATE_KEY &&
    process.env.SEPOLIA_RPC_URL
  );

  if (shouldRegisterOnChain) {
    console.log('📝 Merchant on-chain registration is enabled');
  } else {
    console.log('⚠️  Merchant on-chain registration is disabled (set DvP_CONTRACT_ADDRESS, PRIVATE_KEY, SEPOLIA_RPC_URL to enable)');
  }

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

  let merchantCounter = 1; // Start merchant IDs from 1

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
        contractMerchantId: string | null;
        merchantAddress: string | null;
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
            // Use existing contractMerchantId and merchantAddress if they exist
            contractMerchantId: existingWithContracts.contractMerchantId || merchantCounter.toString(),
            merchantAddress: existingWithContracts.merchantAddress || DEFAULT_MERCHANT_ADDRESS,
          } as any, // Type assertion needed until Prisma Client is regenerated
        });
        console.log(`  → Updated contract addresses for "${merchantData.name}"`);
      }
      // Increment counter even for existing merchants to keep IDs consistent
      if (!existingWithContracts.contractMerchantId) {
        merchantCounter++;
      } else {
        merchantCounter++;
      }
      continue;
    }

    // Generate merchant ID for contract (sequential starting from 1)
    const contractMerchantId = merchantCounter.toString();
    merchantCounter++;

    // Use default merchant address for all merchants
    const merchantAddress = DEFAULT_MERCHANT_ADDRESS;

    // Register merchant on-chain if enabled
    let registrationResult = null;
    if (shouldRegisterOnChain && merchantData.dvpContractAddress) {
      try {
        registrationResult = await registerMerchantOnChain(
          {
            contractAddress: merchantData.dvpContractAddress,
            privateKey: process.env.PRIVATE_KEY!,
            rpcUrl: process.env.SEPOLIA_RPC_URL!,
          },
          {
            merchantId: contractMerchantId,
            merchantAddress: merchantAddress,
          },
        );

        if (registrationResult.success) {
          console.log(`  ✓ Registered merchant "${merchantData.name}" on-chain (ID: ${contractMerchantId}, TX: ${registrationResult.transactionHash})`);
        } else {
          console.log(`  ⚠️  Failed to register merchant "${merchantData.name}" on-chain: ${registrationResult.error}`);
        }
      } catch (error) {
        console.error(`  ❌ Error registering merchant "${merchantData.name}" on-chain:`, error);
        registrationResult = { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    const created = await prisma.merchant.upsert({
      where: { apiKey },
      update: {
        dvpContractAddress: merchantData.dvpContractAddress,
        consentedPullContractAddress: merchantData.consentedPullContractAddress,
        contractMerchantId: contractMerchantId,
        merchantAddress: merchantAddress,
      } as any, // Type assertion needed until Prisma Client is regenerated
      create: {
        name: merchantData.name,
        apiKey,
        isActive: true,
        dvpContractAddress: merchantData.dvpContractAddress,
        consentedPullContractAddress: merchantData.consentedPullContractAddress,
        contractMerchantId: contractMerchantId,
        merchantAddress: merchantAddress,
      } as any, // Type assertion needed until Prisma Client is regenerated
    });

    console.log(`✓ Created merchant "${created.name}" with API key: ${created.apiKey}`);
    console.log(`  → Contract Merchant ID: ${contractMerchantId}`);
    console.log(`  → Merchant Address: ${merchantAddress}`);
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
    const merchantWithContracts = m as unknown as {
      contractMerchantId: string | null;
      merchantAddress: string | null;
    };
    const contractInfo = merchantWithContracts.contractMerchantId 
      ? ` (Contract ID: ${merchantWithContracts.contractMerchantId}, Address: ${merchantWithContracts.merchantAddress || DEFAULT_MERCHANT_ADDRESS})`
      : '';
    console.log(`  - ${m.name}: ${m.apiKey}${contractInfo}`);
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
