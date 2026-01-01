import { PrismaClient } from '@prisma/client';

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

  // Hackathon merchants (4-5 merchants)
  const hackathonMerchants = [
    { name: 'Acme Corp', apiKeyPrefix: 'sk_hackathon_' },
    { name: 'Widget Inc', apiKeyPrefix: 'sk_hackathon_' },
    { name: 'TechStart', apiKeyPrefix: 'sk_hackathon_' },
    { name: 'GlobalPay', apiKeyPrefix: 'sk_hackathon_' },
  ];

  // Test merchant
  const testMerchant = { name: 'Test Merchant', apiKeyPrefix: 'sk_test_' };

  // Live merchant (example)
  const liveMerchant = { name: 'Production Merchant', apiKeyPrefix: 'sk_live_' };

  const allMerchants = [...hackathonMerchants, testMerchant, liveMerchant];

  for (const merchant of allMerchants) {
    const apiKey = generateApiKey(merchant.apiKeyPrefix);

    const existing = await prisma.merchant.findUnique({
      where: { apiKey },
    });

    if (existing) {
      console.log(`✓ Merchant "${merchant.name}" already exists with API key: ${apiKey}`);
      continue;
    }

    const created = await prisma.merchant.upsert({
      where: { apiKey },
      update: {},
      create: {
        name: merchant.name,
        apiKey,
        isActive: true,
      },
    });

    console.log(`✓ Created merchant "${created.name}" with API key: ${created.apiKey}`);
  }

  console.log('✅ Seeding complete!');
  console.log('\n📋 Merchant API Keys:');
  const merchants = await prisma.merchant.findMany({
    orderBy: { createdAt: 'asc' },
  });
  merchants.forEach((m) => {
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

