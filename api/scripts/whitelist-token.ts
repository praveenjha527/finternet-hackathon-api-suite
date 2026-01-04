#!/usr/bin/env bun

/**
 * Whitelist Token Script
 * 
 * This script whitelists a token address in the DVPEscrowWithSettlement contract.
 * Only the contract owner can whitelist tokens.
 */

import dotenv from 'dotenv';
import { Contract, JsonRpcProvider, Wallet, isAddress } from 'ethers';
import { DVPEscrowWithSettlementAbi } from '../src/contracts/types';

dotenv.config();

interface WhitelistTokenConfig {
  contractAddress: string;
  tokenAddress: string;
  privateKey: string;
  rpcUrl: string;
}

async function whitelistToken(config: WhitelistTokenConfig): Promise<void> {
  const { contractAddress, tokenAddress, privateKey, rpcUrl } = config;

  // Validate addresses
  if (!isAddress(contractAddress)) {
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }

  if (!isAddress(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }

  // Initialize provider and signer
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  console.log(`🔗 Connecting to contract at ${contractAddress}...`);
  console.log(`📝 Using wallet: ${wallet.address}`);

  // Get contract instance
  const contract = new Contract(
    contractAddress,
    DVPEscrowWithSettlementAbi,
    wallet,
  );

  // Check if token is already whitelisted
  try {
    const isWhitelisted = await contract.whitelistedTokens(tokenAddress);
    if (isWhitelisted) {
      console.log(`✅ Token ${tokenAddress} is already whitelisted`);
      return;
    }
  } catch (error) {
    console.log(`⚠️  Could not check whitelist status, proceeding...`);
  }

  // Check if caller is owner (optional - contract will revert if not)
  try {
    const owner = await contract.owner();
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.warn(`⚠️  Warning: Wallet ${wallet.address} is not the contract owner (${owner})`);
      console.warn(`   The transaction may fail if you don't have permission to whitelist tokens.`);
    } else {
      console.log(`✅ Wallet is the contract owner`);
    }
  } catch (error) {
    console.log(`⚠️  Could not verify ownership, proceeding...`);
  }

  // Whitelist the token
  console.log(`\n🔄 Whitelisting token ${tokenAddress}...`);
  
  try {
    const tx = await contract.whitelistToken(tokenAddress);
    console.log(`📤 Transaction submitted: ${tx.hash}`);
    console.log(`⏳ Waiting for confirmation...`);

    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error('Transaction receipt not received');
    }

    console.log(`\n✅ Token successfully whitelisted!`);
    console.log(`   Transaction Hash: ${receipt.hash}`);
    console.log(`   Block Number: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);

    // Verify whitelist status
    const isWhitelisted = await contract.whitelistedTokens(tokenAddress);
    console.log(`\n🔍 Verification:`);
    console.log(`   Token ${tokenAddress} is whitelisted: ${isWhitelisted ? '✅ Yes' : '❌ No'}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`\n❌ Failed to whitelist token: ${errorMessage}`);
    
    if (errorMessage.includes('Ownable: caller is not the owner')) {
      console.error(`\n💡 Solution: Use the contract owner's private key to whitelist tokens.`);
    }
    
    throw error;
  }
}

async function main() {
  const contractAddress = process.env.DvP_CONTRACT_ADDRESS;
  const tokenAddress = process.env.TOKEN_ADDRESS || '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8'; // USDC Sepolia default
  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.SEPOLIA_RPC_URL;

  if (!contractAddress) {
    console.error('❌ DvP_CONTRACT_ADDRESS not set in .env');
    process.exit(1);
  }

  if (!privateKey) {
    console.error('❌ PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  if (!rpcUrl) {
    console.error('❌ SEPOLIA_RPC_URL not set in .env');
    process.exit(1);
  }

  console.log('🚀 Whitelist Token Script\n');
  console.log('Configuration:');
  console.log(`   Contract: ${contractAddress}`);
  console.log(`   Token: ${tokenAddress}`);
  console.log(`   RPC: ${rpcUrl}\n`);

  try {
    await whitelistToken({
      contractAddress,
      tokenAddress,
      privateKey,
      rpcUrl,
    });
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  }
}

main();

