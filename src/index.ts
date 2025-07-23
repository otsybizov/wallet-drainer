#!/usr/bin/env ts-node
import { Command } from 'commander';
import axios from 'axios';
import { Wallet, JsonRpcProvider, Contract, parseEther, formatUnits, formatEther, ZeroAddress } from 'ethers';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const EVERCLEAR_CONFIG_URL = 'https://raw.githubusercontent.com/connext/chaindata/main/everclear.json';
const RPCS_URL = 'https://chainlist.org/rpcs.json';
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address,uint256) returns (bool)',
];

const program = new Command();

program
  .name('drain-wallet')
  .description('Drain all tokens and native balance from an EOA across EVM chains')
  .requiredOption('-k, --private-key <key>', 'Private key of the EOA to drain')
  .requiredOption('-o, --out <address>', 'Destination address to receive funds')
  .option('--dry-run', 'Simulate actions without sending transactions', false)
  .option('--force', 'Skip confirmation prompt and proceed with transfers', false)
  .option('--max-gas-price <gwei>', 'Maximum gas price (in gwei) for transactions', parseFloat)
  .parse(process.argv);

const opts = program.opts();

async function fetchConfigs() {
  const [everclearRes, rpcsRes] = await Promise.all([axios.get(EVERCLEAR_CONFIG_URL), axios.get(RPCS_URL)]);
  const everclear = everclearRes.data;
  const rpcs = rpcsRes.data;
  return { everclear, rpcs };
}

function getEvmChains(everclear: any) {
  if (typeof everclear.chains !== 'object' || everclear.chains === null) throw new Error('Invalid everclear.json format');
  // Convert object to array and add chainId to each chain
  return Object.entries(everclear.chains)
    .map(([chainId, chain]: [string, any]) => ({ ...chain, chainId: Number(chainId) }))
    .filter((chain: any) => chain.network === 'evm');
}

function getRpcForChain(chain: any, rpcs: any): string | null {
  const chainId = chain.chainId;
  const rpcEntry = rpcs.find((r: any) => {
    return (
      r.chainId === chainId ||
      r.chainId === `0x${Number(chainId).toString(16)}` ||
      r.chainId === Number(chainId)
    );
  });
  if (rpcEntry && Array.isArray(rpcEntry.rpc) && rpcEntry.rpc.length > 0) {
    return rpcEntry.rpc[0].url;
  }
  return null;
}

async function dryRunDrain(chain: any, rpcUrl: string, tokens: any[], wallet: Wallet, outAddress: string) {
  const provider = new JsonRpcProvider(rpcUrl);
  const connectedWallet = wallet.connect(provider);
  const address = await connectedWallet.getAddress();
  console.log(`\n[${chain.chainId}]`);
  console.log(`  Wallet: ${address}`);
  // Drain non-native tokens first
  for (const token of tokens.filter((t: any) => !t.isNative)) {
    try {
      const contract = new Contract(token.address, ERC20_ABI, provider);
      const balance: bigint = await contract.balanceOf(address);
      if (balance > 0n) {
        const decimals = token.decimals || (await contract.decimals());
        const symbol = token.symbol || (await contract.symbol());
        const formatted = formatUnits(balance, decimals);
        console.log(`  [DRY-RUN] Would send ${formatted} ${symbol} (${token.address}) to ${outAddress}`);
      }
    } catch (err) {
      console.warn(`  [WARN] Could not check/send token ${token.symbol || token.address}:`, (err as Error).message);
    }
  }
  // Drain native token
  try {
    const nativeToken = tokens.find((t: any) => t.isNative);
    const balance: bigint = await provider.getBalance(address);
    // Estimate gas for the transfer
    const txRequest = {
      to: outAddress,
      value: balance, // placeholder, will adjust below
    };
    const estimatedGas = await provider.estimateGas(txRequest);
    const feeData = await provider.getFeeData();
    const currentGasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (currentGasPrice == null) {
      console.warn('  [WARN] Could not determine gas price for dry run. Skipping native token.');
      return;
    }
    const totalGasCost = estimatedGas * currentGasPrice;
    if (balance > totalGasCost) {
      const sendAmount = balance - totalGasCost;
      const formatted = formatEther(sendAmount);
      console.log(`  [DRY-RUN] Would send ${formatted} ${nativeToken ? nativeToken.symbol : 'ETH'} (native) to ${outAddress}`);
    } else {
      console.log('  Not enough native token to send (after gas cost).');
    }
  } catch (err) {
    console.warn('  [WARN] Could not check/send native token:', (err as Error).message);
  }
}

async function confirmProceed(chains: any[], outAddress: string) {
  const rl = readline.createInterface({ input, output });
  console.log('\nYou are about to drain the following chains:');
  for (const chain of chains) {
    console.log(`- ${chain.chainId}`);
  }
  console.log(`\nAll funds will be sent to: ${outAddress}`);
  const answer = await rl.question('Are you sure you want to proceed? (yes/no): ');
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function transferAll(chain: any, rpcUrl: string, tokens: any[], wallet: Wallet, outAddress: string, maxGasPriceGwei?: number) {
  const provider = new JsonRpcProvider(rpcUrl);
  const connectedWallet = wallet.connect(provider);
  const address = await connectedWallet.getAddress();
  console.log(`\n[${chain.chainId}]`);
  console.log(`  Wallet: ${address}`);
  // Get current gas price and check against maxGasPrice
  let gasPrice: bigint | undefined;
  if (maxGasPriceGwei !== undefined) {
    try {
      const feeData = await provider.getFeeData();
      // Prefer maxFeePerGas (EIP-1559), fallback to gasPrice
      gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? undefined;
      if (gasPrice === undefined) {
        console.warn('  [WARN] Could not determine gas price. Skipping chain.');
        return;
      }
      const maxGasPrice = parseEther((maxGasPriceGwei / 1e9).toString()); // gwei to ether
      if (gasPrice > maxGasPrice) {
        console.warn(`  [WARN] Gas price too high (${formatUnits(gasPrice, 'gwei')} gwei > ${maxGasPriceGwei} gwei). Skipping chain.`);
        return;
      }
    } catch (err) {
      console.warn('  [WARN] Could not fetch gas price:', (err as Error).message);
    }
  }
  // Transfer non-native tokens first
  for (const token of tokens.filter((t: any) => !t.isNative)) {
    try {
      const contract = new Contract(token.address, ERC20_ABI, connectedWallet);
      const balance: bigint = await contract.balanceOf(address);
      if (balance > 0n) {
        const decimals = token.decimals || (await contract.decimals());
        const symbol = token.symbol || (await contract.symbol());
        const formatted = formatUnits(balance, decimals);
        console.log(`  Sending ${formatted} ${symbol} (${token.address}) to ${outAddress}...`);
        const tx = await contract.transfer(outAddress, balance, gasPrice ? { gasPrice } : {});
        console.log(`    [TX] ${tx.hash} (waiting for confirmation...)`);
        await tx.wait();
        console.log('    [OK] Confirmed!');
      }
    } catch (err) {
      console.warn(`  [WARN] Could not send token ${token.symbol || token.address}:`, (err as Error).message);
    }
  }
  // Transfer native token
  try {
    const nativeToken = tokens.find((t: any) => t.isNative);
    const balance: bigint = await provider.getBalance(address);
    // Estimate gas for the transfer
    const txRequest = {
      to: outAddress,
      value: balance, // placeholder, will adjust below
      ...(gasPrice ? { gasPrice } : {})
    };
    const estimatedGas = await provider.estimateGas(txRequest);
    const feeData = await provider.getFeeData();
    const currentGasPrice = gasPrice ?? (feeData.maxFeePerGas ?? feeData.gasPrice);
    if (currentGasPrice == null) {
      console.warn('  [WARN] Could not determine gas price. Skipping native token transfer.');
      return;
    }
    const totalGasCost = estimatedGas * currentGasPrice;
    if (balance > totalGasCost) {
      const sendAmount = balance - totalGasCost;
      const formatted = formatEther(sendAmount);
      console.log(`  Sending ${formatted} ${nativeToken ? nativeToken.symbol : 'ETH'} (native) to ${outAddress}...`);
      const tx = await connectedWallet.sendTransaction({
        to: outAddress,
        value: sendAmount,
        ...(gasPrice ? { gasPrice } : {})
      });
      console.log(`    [TX] ${tx.hash} (waiting for confirmation...)`);
      await tx.wait();
      console.log('    [OK] Confirmed!');
    } else {
      console.log('  Not enough native token to send (after gas cost).');
    }
  } catch (err) {
    console.warn('  [WARN] Could not send native token:', (err as Error).message);
  }
}

(async () => {
  try {
    const { everclear, rpcs } = await fetchConfigs();
    const evmChains = getEvmChains(everclear);
    const wallet = new Wallet(opts.privateKey);
    for (const chain of evmChains as any[]) {
      const rpcUrl = getRpcForChain(chain, rpcs);
      if (!rpcUrl) {
        console.log(`\n[${chain.chainId}] No RPC found for this chain. Skipping.`);
        continue;
      }
      const tokens = Object.values(chain.assets).map((asset => asset));
      if (opts.dryRun) {
        await dryRunDrain(chain, rpcUrl, tokens, wallet, opts.out);
      } else {
        if (!opts.force) {
          const confirmed = await confirmProceed(evmChains, opts.out);
          if (!confirmed) {
            console.log('Aborted by user.');
            process.exit(0);
          }
          opts.force = true; // Only ask once
        }
        await transferAll(chain, rpcUrl, tokens, wallet, opts.out, opts.maxGasPrice);
      }

      break;
    }
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})(); 