# Wallet Drainer CLI

A CLI tool to automatically drain all tokens and native balances from an EOA (Externally Owned Account) across multiple EVM-compatible chains, sending all funds to a specified output address.

## Features
- 🔗 **Multi-chain**: Supports all EVM chains defined in [everclear.json](https://raw.githubusercontent.com/connext/chaindata/main/everclear.json)
- 🪙 **Token + Native**: Transfers all non-native tokens first, then the native token
- 🧪 **Dry-run mode**: Simulate all actions without sending transactions (`--dry-run`)
- 🛡️ **Safety features**:
  - Confirmation prompt before sending real transactions
  - `--force` flag to skip confirmation
  - `--max-gas-price` to skip chains with high gas
- ⚡ **Automatic RPC selection**: Uses up-to-date RPCs from [chainlist.org](https://chainlist.org/rpcs.json)
- 🚦 **Logs all actions and errors**

## Requirements
- Node.js 18+
- Yarn (for monorepo/workspace install)
- Ethers v6

## Installation
From the monorepo root:
```bash
yarn install
```

## Usage

### Dry-run (no transactions sent)
```bash
yarn start --private-key <PRIVATE_KEY> --out <DEST_ADDRESS> --dry-run
```

### Real transfers (with confirmation prompt)
```bash
yarn start --private-key <PRIVATE_KEY> --out <DEST_ADDRESS>
```

### Real transfers (skip confirmation)
```bash
yarn start --private-key <PRIVATE_KEY> --out <DEST_ADDRESS> --force
```

### Limit max gas price (in gwei)
```bash
yarn start --private-key <PRIVATE_KEY> --out <DEST_ADDRESS> --max-gas-price 30
```

### Skip ERC20 (non-native) token transfers
```bash
yarn start --private-key <PRIVATE_KEY> --out <DEST_ADDRESS> --skip-erc20
```

## CLI Options
- `-k, --private-key <key>`: Private key of the EOA to drain (**required**)
- `-o, --out <address>`: Destination address to receive funds (**required**)
- `--dry-run`: Simulate actions without sending transactions (default: false)
- `--force`: Skip confirmation prompt and proceed with transfers (default: false)
- `--max-gas-price <gwei>`: Maximum gas price (in gwei) for transactions (optional)
- `--skip-erc20`: Skip transferring non-native (ERC20) tokens (default: false)

## Safety Notes
- **Always test with `--dry-run` first!**
- The tool will prompt for confirmation before sending real transactions unless `--force` is used.
- All actions and errors are logged to the console.

## License
MIT

## Attribution
Everclear Team 