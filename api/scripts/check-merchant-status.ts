#!/usr/bin/env bun

/**
 * Check Merchant On-Chain Status
 * 
 * This script checks the on-chain status of all merchants registered in the database.
 * It verifies if merchants are active, KYB verified, and retrieves their contract details.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { getMerchantOnChain } from '../src/modules/auth/utils/merchant-registration.util';

dotenv.config();

const prisma = new PrismaClient();

interface MerchantStatus {
  id: string;
  name: string;
  apiKey: string;
  contractMerchantId: string | null;
  merchantAddress: string | null;
  dvpContractAddress: string | null;
  onChainStatus: {
    exists: boolean;
    isActive: boolean;
    isKybVerified: boolean;
    merchantAddress: string;
    totalOrders: bigint;
    successfulDeliveries: bigint;
    disputes: bigint;
  } | null;
  error?: string;
}

async function checkMerchantStatus(): Promise<void> {
  console.log('🔍 Checking merchant on-chain status...\n');

  // Get contract address from env
  const dvpContractAddress = process.env.DvP_CONTRACT_ADDRESS;
  const rpcUrl = process.env.SEPOLIA_RPC_URL;

  if (!dvpContractAddress) {
    console.error('❌ DvP_CONTRACT_ADDRESS not set in .env');
    process.exit(1);
  }

  if (!rpcUrl) {
    console.error('❌ SEPOLIA_RPC_URL not set in .env');
    process.exit(1);
  }

  // Get all merchants from database
  const merchants = await prisma.merchant.findMany({
    orderBy: { createdAt: 'asc' },
  });

  if (merchants.length === 0) {
    console.log('⚠️  No merchants found in database');
    await prisma.$disconnect();
    return;
  }

  const statuses: MerchantStatus[] = [];

  for (const merchant of merchants) {
    const merchantWithContracts = merchant as unknown as {
      contractMerchantId: string | null;
      merchantAddress: string | null;
      dvpContractAddress: string | null;
    };

    const contractMerchantId = merchantWithContracts.contractMerchantId;
    const merchantAddress = merchantWithContracts.merchantAddress;
    const contractAddress = merchantWithContracts.dvpContractAddress || dvpContractAddress;

    const status: MerchantStatus = {
      id: merchant.id,
      name: merchant.name,
      apiKey: merchant.apiKey,
      contractMerchantId,
      merchantAddress,
      dvpContractAddress: contractAddress,
      onChainStatus: null,
    };

    // Skip if no contractMerchantId
    if (!contractMerchantId) {
      status.error = 'No contractMerchantId in database';
      statuses.push(status);
      continue;
    }

    // Skip if no contract address
    if (!contractAddress) {
      status.error = 'No DvP contract address configured';
      statuses.push(status);
      continue;
    }

    // Check on-chain status
    try {
      const onChainData = await getMerchantOnChain(
        contractAddress,
        rpcUrl,
        BigInt(contractMerchantId),
      );

      if (onChainData) {
        status.onChainStatus = {
          exists: true,
          isActive: onChainData.isActive,
          isKybVerified: onChainData.isKybVerified,
          merchantAddress: onChainData.merchantAddress,
          totalOrders: onChainData.totalOrders,
          successfulDeliveries: onChainData.successfulDeliveries,
          disputes: onChainData.disputes,
        };
      } else {
        status.error = 'Merchant not found on-chain';
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : 'Unknown error';
    }

    statuses.push(status);
  }

  // Print results
  console.log('📊 Merchant Status Report\n');
  console.log('='.repeat(80));

  for (const status of statuses) {
    console.log(`\n🏢 ${status.name}`);
    console.log(`   API Key: ${status.apiKey.substring(0, 20)}...`);
    console.log(`   Contract Merchant ID: ${status.contractMerchantId || 'N/A'}`);
    console.log(`   Merchant Address: ${status.merchantAddress || 'N/A'}`);
    console.log(`   Contract Address: ${status.dvpContractAddress || 'N/A'}`);

    if (status.error) {
      console.log(`   ❌ Error: ${status.error}`);
    } else if (status.onChainStatus) {
      const s = status.onChainStatus;
      console.log(`   ✅ On-Chain Status:`);
      console.log(`      - Exists: ${s.exists ? '✅' : '❌'}`);
      console.log(`      - Active: ${s.isActive ? '✅' : '❌'}`);
      console.log(`      - KYB Verified: ${s.isKybVerified ? '✅' : '❌'}`);
      console.log(`      - On-Chain Address: ${s.merchantAddress}`);
      console.log(`      - Total Orders: ${s.totalOrders.toString()}`);
      console.log(`      - Successful Deliveries: ${s.successfulDeliveries.toString()}`);
      console.log(`      - Disputes: ${s.disputes.toString()}`);

      // Check if addresses match
      if (status.merchantAddress && s.merchantAddress.toLowerCase() !== status.merchantAddress.toLowerCase()) {
        console.log(`      ⚠️  Address Mismatch: DB has ${status.merchantAddress}, contract has ${s.merchantAddress}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));

  // Summary
  const activeCount = statuses.filter(
    (s) => s.onChainStatus?.isActive === true,
  ).length;
  const inactiveCount = statuses.filter(
    (s) => s.onChainStatus?.isActive === false,
  ).length;
  const notFoundCount = statuses.filter(
    (s) => !s.onChainStatus && !s.error?.includes('No contractMerchantId'),
  ).length;
  const errorCount = statuses.filter((s) => s.error && !s.onChainStatus).length;

  console.log('\n📈 Summary:');
  console.log(`   Total Merchants: ${statuses.length}`);
  console.log(`   ✅ Active: ${activeCount}`);
  console.log(`   ❌ Inactive: ${inactiveCount}`);
  console.log(`   🔍 Not Found: ${notFoundCount}`);
  console.log(`   ⚠️  Errors: ${errorCount}`);

  if (inactiveCount > 0 || notFoundCount > 0) {
    console.log('\n⚠️  Some merchants are not active or not found on-chain.');
    console.log('   Run `bun run prisma:seed` to register merchants on-chain.');
  }

  await prisma.$disconnect();
}

// Run the script
checkMerchantStatus()
  .catch((error) => {
    console.error('❌ Error checking merchant status:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

