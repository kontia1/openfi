const { ethers, Wallet, JsonRpcProvider, toBeHex, zeroPadValue, parseUnits, Contract } = require("ethers");
const fs = require("fs");

// --- CONFIGURATION ---
const RPC_URL = "https://testnet.dplabs-internal.com";
const routerAddress = "0xad3b4e20412a097f87cd8e8d84fbbe17ac7c89e9";

// Token addresses (symbol: address)
const tokens = {
  USDC: "0x48249feEb47a8453023f702f15CF00206eeBdF08",
  USDT: "0x0B00Fb1F513E02399667FBA50772B21f34c1b5D9",
  BTC: "0xA4a967FC7cF0E9815bF5c2700A055813628b65BE",
  GOLD: "0x77f532df5f46DdFf1c97CDae3115271A523fa0f4",
  TSLA: "0xCDA3DF4AAB8a571688fE493EB1BdC1Ad210C09E4",
  NVIDIA: "0x3299cc551B2a39926Bf14144e65630e533dF6944"
};

// Per-token decimals (symbol: decimals)
const tokenDecimals = {
  USDC: 6,
  USDT: 6,
  BTC: 8,
  GOLD: 18,
  TSLA: 18,
  NVIDIA: 18
};

// Borrow amounts per your original request
const borrowAmounts = {
  USDC: "0.1",
  USDT: "0.1",
  BTC: "0.00001",
  GOLD: "0.0002",
  TSLA: "0.00005",
  NVIDIA: "0.00003"
};
const repayAmounts = borrowAmounts; // Repay same as borrow

// Mint router config (for testnet/mock tokens)
const mintAmount = "100";
const mintRouter = {
  address: "0x2e9d89d372837f71cb529e5ba85bfbc1785c69cd",
  abi: [
    {
      name: "mint",
      type: "function",
      inputs: [
        { name: "_asset", type: "address" },
        { name: "_account", type: "address" },
        { name: "_amount", type: "uint256" }
      ],
      outputs: [],
      stateMutability: "nonpayable"
    }
  ],
  func: "mint"
};

// ERC20 ABI fragment for approve/allowance
const erc20Abi = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function allowance(address owner, address spender) public view returns (uint256)"
];

// Router ABI fragments for "supply" and "withdraw"
const supplyAbi = [
  {
    name: "supply",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  }
];
const withdrawAbi = [
  {
    name: "withdraw",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" }
    ],
    outputs: [
      { name: "amountWithdrawn", type: "uint256" }
    ],
    stateMutability: "nonpayable"
  }
];

// Function selectors for router raw calls
const borrowSelector = "a415bcad";    // borrow(address,uint256,uint256,uint16,address)
const repaySelector = "26a4e8d2";     // repay(address,uint256,uint256,address)
const interestRateMode = 2;

// --- HELPER FUNCTIONS ---
function strip0x(hex) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function encodeRouterData(selector, asset, amount, interestRateMode, onBehalfOf) {
  let data = "0x" + selector +
    strip0x(zeroPadValue(asset, 32).toString("hex")) +
    strip0x(toBeHex(amount, 32));
  if (interestRateMode !== undefined && interestRateMode !== null) {
    data += strip0x(toBeHex(interestRateMode, 32));
    data += "0".repeat(64); // referralCode/padding
  }
  data += strip0x(zeroPadValue(onBehalfOf, 32).toString("hex"));
  return data;
}

function getRandomSupplyAmount(min, max, decimals) {
  // Returns a BigInt for ethers
  const rand = Math.random() * (max - min) + min;
  return ethers.parseUnits(rand.toFixed(6), decimals);
}

const privateKeys = fs.readFileSync('data.txt', 'utf-8')
  .split('\n').map(l => l.trim()).filter(Boolean);

if (privateKeys.length === 0) {
  console.error("No private keys found in data.txt");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

async function main() {
  for (const pk of privateKeys) {
    const wallet = new ethers.Wallet(pk, provider);
    const onBehalfOf = wallet.address;
    console.log(`\n======== WALLET: ${wallet.address} ========`);

    // ----- MINT -----
    const mintContract = new ethers.Contract(mintRouter.address, mintRouter.abi, wallet);
    for (const [symbol, tokenAddress] of Object.entries(tokens)) {
      const decimals = tokenDecimals[symbol];
      const amt = ethers.parseUnits(mintAmount, decimals);
      try {
        console.log(`[${symbol}] Minting ${mintAmount} (${amt})...`);
        const tx = await mintContract[mintRouter.func](
          tokenAddress,
          wallet.address,
          amt,
          { gasPrice: ethers.parseUnits("5", "gwei") }
        );
        console.log(`[${symbol}]   Mint tx: ${tx.hash}`);
        await tx.wait();
        console.log(`[${symbol}]   Mint confirmed`);
      } catch (err) {
        console.error(`[${symbol}]   Mint failed/skipped:`, err.reason || err.message || err);
      }
    }

    // ----- APPROVE -----
    for (const [symbol, tokenAddress] of Object.entries(tokens)) {
      const decimals = tokenDecimals[symbol];
      const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, wallet);

      let allowance = 0n;
      try {
        allowance = await tokenContract.allowance(wallet.address, routerAddress);
      } catch (e) {
        console.error(`[${symbol}]   Allowance fetch error:`, e.reason || e.message || e);
      }
      const maxUint = ethers.MaxUint256;
      if (allowance < maxUint / 2n) {
        try {
          console.log(`[${symbol}] Approving router unlimited...`);
          const approveTx = await tokenContract.approve(routerAddress, maxUint, { gasPrice: ethers.parseUnits("5", "gwei") });
          console.log(`[${symbol}]   Approve tx: ${approveTx.hash}`);
          await approveTx.wait();
          console.log(`[${symbol}]   Approval confirmed`);
        } catch (e) {
          console.error(`[${symbol}]   Approve failed:`, e.reason || e.message || e);
          continue;
        }
      } else {
        console.log(`[${symbol}]   Already unlimited approval`);
      }
    }

    // ----- SUPPLY -----
    const supplyContract = new ethers.Contract(routerAddress, supplyAbi, wallet);
    // Save actual supplied amount for withdraw step
    const suppliedAmounts = {};
    for (const [symbol, tokenAddress] of Object.entries(tokens)) {
      const decimals = tokenDecimals[symbol];
      // Random supply between 50 and 80
      const supplyAmt = getRandomSupplyAmount(50, 80, decimals);
      suppliedAmounts[symbol] = supplyAmt;
      try {
        console.log(`[${symbol}] Supplying ${ethers.formatUnits(supplyAmt, decimals)} (${supplyAmt})...`);
        const tx = await supplyContract.supply(
          tokenAddress,
          supplyAmt,
          wallet.address,
          0,
          { gasPrice: ethers.parseUnits("5", "gwei") }
        );
        console.log(`[${symbol}]   Supply tx: ${tx.hash}`);
        await tx.wait();
        console.log(`[${symbol}]   Supply confirmed`);
      } catch (e) {
        console.error(`[${symbol}]   Supply failed:`, e.reason || e.message || e);
      }
    }

    // ----- WITHDRAW -----
    const withdrawContract = new ethers.Contract(routerAddress, withdrawAbi, wallet);
    for (const [symbol, tokenAddress] of Object.entries(tokens)) {
      const decimals = tokenDecimals[symbol];
      // Withdraw 10% of supplied
      const withdrawAmt = suppliedAmounts[symbol] / 10n;
      try {
        console.log(`[${symbol}] Withdrawing 10% = ${ethers.formatUnits(withdrawAmt, decimals)} (${withdrawAmt})...`);
        const tx = await withdrawContract.withdraw(
          tokenAddress,
          withdrawAmt,
          wallet.address,
          { gasPrice: ethers.parseUnits("5", "gwei") }
        );
        console.log(`[${symbol}]   Withdraw tx: ${tx.hash}`);
        await tx.wait();
        console.log(`[${symbol}]   Withdraw confirmed`);
      } catch (e) {
        console.error(`[${symbol}]   Withdraw failed:`, e.reason || e.message || e);
      }
    }

    // ----- BORROW -----
    for (const symbol of Object.keys(tokens)) {
      const tokenAddress = tokens[symbol];
      const decimals = tokenDecimals[symbol];
      const amountStr = borrowAmounts[symbol];
      const amt = parseUnits(amountStr, decimals);
      const borrowData = encodeRouterData(borrowSelector, tokenAddress, amt, interestRateMode, onBehalfOf);
      const txObj = { to: routerAddress, data: borrowData };

      try {
        console.log(`[${symbol}] Borrowing ${amountStr} (${amt})...`);
        const tx = await wallet.sendTransaction(txObj);
        console.log(`[${symbol}]   Borrow tx: ${tx.hash}`);
        await tx.wait();
        console.log(`[${symbol}]   Borrow confirmed`);
      } catch (e) {
        console.error(`[${symbol}]   Borrow failed:`, e.reason || e.message || e);
      }
    }

    // ----- REPAY -----
    for (const symbol of Object.keys(tokens)) {
      const tokenAddress = tokens[symbol];
      const decimals = tokenDecimals[symbol];
      const amountStr = repayAmounts[symbol];
      const amt = parseUnits(amountStr, decimals);
      const repayData = encodeRouterData(repaySelector, tokenAddress, amt, interestRateMode, onBehalfOf);
      const txObj = { to: routerAddress, data: repayData };

      try {
        console.log(`[${symbol}] Repaying ${amountStr} (${amt})...`);
        const tx = await wallet.sendTransaction(txObj);
        console.log(`[${symbol}]   Repay tx: ${tx.hash}`);
        await tx.wait();
        console.log(`[${symbol}]   Repay confirmed`);
      } catch (e) {
        console.error(`[${symbol}]   Repay failed:`, e.reason || e.message || e);
      }
    }
  }
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
