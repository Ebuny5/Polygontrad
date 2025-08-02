// =================================================================
// OPTIMIZED FLASH LOAN ARBITRAGE BOT - EXPANDED WITH MULTI-DEX SUPPORT (MODIFIED)
// =================================================================

require('dotenv').config();
const { ethers } = require('ethers');

const CONFIG = {
    ARBITRAGE_CONTRACT_ADDRESS: '0x585e57f419de97481fb7c013fa8f25141760a01c',
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RPC_URL: process.env.ALCHEMY_RPC_URL,

    MAX_GAS_PRICE_GWEI: 50,
    GAS_LIMIT: 800000,
    MIN_PROFIT_USD: 0.15,
    SLIPPAGE_TOLERANCE: 0.025, // 2.5%

    FLASH_LOAN_AMOUNTS: ['5', '10', '25', '50', '100', '250'],

    PAIRS: [
        { tokenA: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', tokenB: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimalsA: 18, decimalsB: 6, uniswapFee: 500, symbol: 'WMATIC/USDC' },
        { tokenA: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', tokenB: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimalsA: 6, decimalsB: 6, uniswapFee: 100, symbol: 'USDC/USDT' },
        { tokenA: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', tokenB: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimalsA: 18, decimalsB: 6, uniswapFee: 500, symbol: 'WETH/USDC' },
        { tokenA: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', tokenB: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimalsA: 8, decimalsB: 6, uniswapFee: 500, symbol: 'WBTC/USDC' },
        { tokenA: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', tokenB: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimalsA: 18, decimalsB: 6, uniswapFee: 100, symbol: 'DAI/USDC' },
        { tokenA: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', tokenB: '0x0d500B1d8E8eF31E21C99D1Db9A6444d3ADf1270', decimalsA: 6, decimalsB: 18, uniswapFee: 500, symbol: 'USDC/WMATIC' },
        { tokenA: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', tokenB: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimalsA: 6, decimalsB: 18, uniswapFee: 500, symbol: 'USDC/WETH' },
        { tokenA: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', tokenB: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimalsA: 18, decimalsB: 6, uniswapFee: 3000, symbol: 'LINK/USDC' },
        { tokenA: '0x0d500B1d8E8eF31E21C99D1Db9A6444d3ADf1270', tokenB: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimalsA: 18, decimalsB: 18, uniswapFee: 3000, symbol: 'WMATIC/WETH' }
    ],

    UNISWAP_V3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    SUSHISWAP_V2_ROUTER: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    QUICKSWAP_V2_ROUTER: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
    KYBERSWAP_ROUTER: '0x546C79662E028B661dFB4767664d0273184E4dD1', // KyberSwap Classic Router (Polygon)
    UNISWAP_V3_QUOTER: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',

    POL_PRICE_USD: 0.55, // Price of 1 MATIC in USD
    WETH_PRICE_USD: 3750, // Approx
    WBTC_PRICE_USD: 68000, // Approx
    LINK_PRICE_USD: 17.5, // Approx

    SCAN_INTERVAL_MS: 8000,
    DEBUG_MODE: true, // <<<< ENABLED DEBUG MODE BY DEFAULT
    OPPORTUNITY_ALERT_MODE: true,

    // Standard fee for V2 DEXes like SushiSwap, QuickSwap (0.3% = 30 BPS)
    V2_STANDARD_FEE_BPS: 30n, // 30 basis points (out of 10000)
};

class FlashLoanArbitrageBot {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
        this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);

        // DEX contract ABIs
        const sushiRouterABI = [ // Standard V2 Router ABI
            'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
        ];
        const v3QuoterABI = [
            'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)'
        ];

        // Initialize DEX contracts
        this.sushiSwap = new ethers.Contract(CONFIG.SUSHISWAP_V2_ROUTER, sushiRouterABI, this.provider);
        this.quickSwap = new ethers.Contract(CONFIG.QUICKSWAP_V2_ROUTER, sushiRouterABI, this.provider);
        this.kyberSwap = new ethers.Contract(CONFIG.KYBERSWAP_ROUTER, sushiRouterABI, this.provider); // Assuming V2 compatible interface
        this.uniV3Quoter = new ethers.Contract(CONFIG.UNISWAP_V3_QUOTER, v3QuoterABI, this.provider);

        // Initialize arbitrage contract
        const contractABI = [
            'function executeArbitrage(address tokenA, address tokenB, uint256 amountA, uint24 feeAtoB, uint256 amountOutMinA, tuple(uint256 maxGasPriceGwei, uint256 blockNumberDeadline, bytes32 priceCommitment, bool useCommitReveal) memory protection) external',
            'event ArbitrageExecuted(address indexed tokenA, address indexed tokenB, uint256 amountIn, uint256 profit, bytes32 indexed txHash)',
            'event DebugLog(string message, uint256 value)',
            'function owner() external view returns (address)',
            'function emergencyWithdraw(address token) external'
        ];
        this.contract = new ethers.Contract(CONFIG.ARBITRAGE_CONTRACT_ADDRESS, contractABI, this.wallet);

        this.executionInProgress = false;
        this.totalScans = 0;
        this.opportunitiesFound = 0;
        this.nearMisses = 0;
        this.bestSpreadSeen = -Infinity; // Initialize to negative infinity
        this.lastOpportunityTime = Date.now();
    }

    debugLog(message, data = null) {
        if (CONFIG.DEBUG_MODE) {
            const timestamp = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
            if (data !== null && data !== undefined) { // Check for null or undefined specifically
                 // Try to format BigInts for readability if they are common
                if (typeof data === 'bigint') {
                    console.log(`[${timestamp}] ${message}: ${data.toString()}`);
                } else if (typeof data === 'object' && data !== null) {
                    // Basic object logging, could be improved for nested BigInts
                    console.log(`[${timestamp}] ${message}:`, JSON.stringify(data, (key, value) =>
                        typeof value === 'bigint' ? value.toString() : value, 2));
                }
                 else {
                    console.log(`[${timestamp}] ${message}:`, data);
                }
            } else {
                console.log(`[${timestamp}] ${message}`);
            }
        }
    }

    async start() {
        console.log('🚀 OPTIMIZED Flash Loan Arbitrage Bot - Multi-DEX (MODIFIED)');
        console.log(`✈️ Wallet: ${this.wallet.address}`);
        console.log(`💰 Min Profit: $${CONFIG.MIN_PROFIT_USD}`);
        console.log(`📊 Tracking ${CONFIG.PAIRS.length} pairs with ${CONFIG.FLASH_LOAN_AMOUNTS.length} loan sizes`);
        console.log(`⚡ DEXes for 2nd hop: SushiSwap, QuickSwap, KyberSwap (Classic)`);
        console.log(`🐞 DEBUG MODE: ${CONFIG.DEBUG_MODE}`);


        try {
            const owner = await this.contract.owner();
            if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
                console.error(`❌ CRITICAL: Wallet ${this.wallet.address} is NOT the owner of contract ${CONFIG.ARBITRAGE_CONTRACT_ADDRESS}. Owner is ${owner}. Exiting.`);
                process.exit(1);
            }
            console.log('✅ Contract owner verified');
        } catch (err) {
            console.error('❌ Contract ownership check failed:', err.message);
            process.exit(1);
        }

        await this.quickConnectivityTest();

        while (true) {
            try {
                if (this.executionInProgress) {
                    this.debugLog('⏳ Execution in progress, sleeping...');
                    await this.sleep(5000);
                    continue;
                }
                this.totalScans++;
                const feeData = await this.provider.getFeeData();
                const gasPriceGwei = parseFloat(ethers.formatUnits(feeData.gasPrice, 'gwei'));

                if (gasPriceGwei > CONFIG.MAX_GAS_PRICE_GWEI) {
                    console.log(`⛽ Gas too high: ${gasPriceGwei.toFixed(1)} Gwei (Limit: ${CONFIG.MAX_GAS_PRICE_GWEI} Gwei). Waiting...`);
                    await this.sleep(CONFIG.SCAN_INTERVAL_MS * 2); // Wait longer if gas is high
                    continue;
                }
                const minutesSince = Math.floor((Date.now() - this.lastOpportunityTime) / 60000);
                console.log(`\n🔍 Scan #${this.totalScans} | Gas: ${gasPriceGwei.toFixed(1)}g | Found: ${this.opportunitiesFound} | Near: ${this.nearMisses} | Best Spread: ${this.bestSpreadSeen > -Infinity ? this.bestSpreadSeen.toFixed(3) + '%' : 'N/A'} | Last Arb: ${this.opportunitiesFound > 0 ? minutesSince + 'm ago' : 'Never'}`);

                let foundInLoop = false;
                for (const pair of CONFIG.PAIRS) {
                    for (const amountStr of CONFIG.FLASH_LOAN_AMOUNTS) {
                        const opp = await this.checkArbitrageOpportunity(pair, amountStr, feeData.gasPrice);
                        if (opp && opp.profitable) {
                            this.opportunitiesFound++;
                            this.lastOpportunityTime = Date.now();
                            console.log(`🎯 PROFITABLE ARBITRAGE FOUND! Pair: ${pair.symbol}, Loan: ${amountStr} ${pair.symbol.split('/')[0]}, Expected: ${opp.profitFormatted}, Spread: ${opp.spreadPercent}%`);
                            await this.executeFlashLoan(pair, opp, feeData.gasPrice);
                            foundInLoop = true;
                            await this.sleep(15000); // Wait a bit longer after an attempt
                            break; // Break from amountStr loop
                        } else if (opp && opp.nearMiss) {
                            this.nearMisses++;
                            if (CONFIG.OPPORTUNITY_ALERT_MODE && this.totalScans % 10 === 0) { // Log near misses less frequently
                                console.log(`💡 Near miss (${opp.dexUsedForHop2}): ${pair.symbol} loan ${amountStr}, needs $${(CONFIG.MIN_PROFIT_USD - opp.profitUSD).toFixed(3)} more (Profit USD: ${opp.profitUSD.toFixed(3)})`);
                            }
                        }
                    }
                    if (foundInLoop) break; // Break from pair loop
                }
            } catch (err) {
                console.error('❌ Main loop error:', err.message, err.stack);
            }
            await this.sleep(CONFIG.SCAN_INTERVAL_MS);
        }
    }

    async quickConnectivityTest() {
        try {
            const block = await this.provider.getBlockNumber();
            console.log(`✅ Connected to RPC. Current block: ${block}`);
        } catch (e) {
            console.error(`❌ RPC connection test failed: ${e.message}. Check RPC_URL. Exiting.`);
            process.exit(1);
        }
    }

    async checkArbitrageOpportunity(pair, amountStr, gasPrice) {
        const tokenASymbol = pair.symbol.split('/')[0];
        const tokenBSymbol = pair.symbol.split('/')[1];
        this.debugLog(`--- Checking: ${pair.symbol} | Loan: ${amountStr} ${tokenASymbol} ---`);

        try {
            const loanAmount = ethers.parseUnits(amountStr, pair.decimalsA);

            // HOP 1: Uniswap V3 (TokenA -> TokenB)
            const amountTokenB_from_UniV3 = await this.getV3Price(pair.tokenA, pair.tokenB, pair.uniswapFee, loanAmount);
            this.debugLog(`  1. UniV3 Output (${tokenBSymbol}): ${ethers.formatUnits(amountTokenB_from_UniV3, pair.decimalsB)} (from ${amountStr} ${tokenASymbol})`);
            if (amountTokenB_from_UniV3 === 0n) {
                this.debugLog("  ❌ UniV3 quote is zero. Skipping.");
                return null;
            }

            // HOP 2: Best of V2 DEXes (TokenB -> TokenA)
            const { bestPrice: finalAmountTokenA_after_V2_fees, dexName: dexUsedForHop2 } = await this.getBestV2Price(amountTokenB_from_UniV3, [pair.tokenB, pair.tokenA], pair.decimalsA, pair.decimalsB);
            this.debugLog(`  2. Best V2 Output (${tokenASymbol}) from ${dexUsedForHop2}: ${ethers.formatUnits(finalAmountTokenA_after_V2_fees, pair.decimalsA)} (after 0.3% fee)`);
            if (finalAmountTokenA_after_V2_fees === 0n) {
                this.debugLog("  ❌ Best V2 quote is zero. Skipping.");
                return null;
            }

            // Calculate Flash Loan Repayment
            const aaveFlashLoanFeeBPS = 9n; // 0.09%
            const aaveFeeAmount = (loanAmount * aaveFlashLoanFeeBPS) / 10000n;
            const totalRepayAmount = loanAmount + aaveFeeAmount;
            this.debugLog(`  Loan Details (${tokenASymbol}):`);
            this.debugLog(`    Initial Loan  : ${ethers.formatUnits(loanAmount, pair.decimalsA)}`);
            this.debugLog(`    Aave Fee (0.09%): ${ethers.formatUnits(aaveFeeAmount, pair.decimalsA)}`);
            this.debugLog(`    Total to Repay: ${ethers.formatUnits(totalRepayAmount, pair.decimalsA)}`);

            // Calculate Gross Profit (after all DEX fees and flash loan fee, but before gas)
            const grossProfit = finalAmountTokenA_after_V2_fees > totalRepayAmount ? finalAmountTokenA_after_V2_fees - totalRepayAmount : 0n;
            this.debugLog(`  Gross Profit (${tokenASymbol}, post-all-fees, pre-gas): ${ethers.formatUnits(grossProfit, pair.decimalsA)}`);

            // Calculate Spread
            const inputForSpread = parseFloat(ethers.formatUnits(loanAmount, pair.decimalsA));
            const outputForSpread = parseFloat(ethers.formatUnits(finalAmountTokenA_after_V2_fees, pair.decimalsA)); // Using amount after V2 fees
            const spread = inputForSpread > 0 ? ((outputForSpread - inputForSpread) / inputForSpread) * 100 : 0;
            if (spread > this.bestSpreadSeen) this.bestSpreadSeen = spread;
            this.debugLog(`  Raw Spread (before loan fee, gas, slippage): ${spread.toFixed(4)}% (Current Best: ${this.bestSpreadSeen.toFixed(4)}%)`);


            if (grossProfit <= 0n) {
                this.debugLog("  ❌ No gross profit after all fees. Skipping.");
                return null;
            }

            // Estimate Gas Cost
            const gasCostInTokenA = await this.estimateGasCostInToken(gasPrice, pair);
            this.debugLog(`  Est. Gas Cost (${tokenASymbol}): ${ethers.formatUnits(gasCostInTokenA, pair.decimalsA)}`);

            // Net Profit Before Slippage
            const netProfitBeforeSlippage = grossProfit > gasCostInTokenA ? grossProfit - gasCostInTokenA : 0n;
            this.debugLog(`  Net Profit (${tokenASymbol}, pre-slippage): ${ethers.formatUnits(netProfitBeforeSlippage, pair.decimalsA)}`);

            if (netProfitBeforeSlippage <= 0n) {
                 this.debugLog("  ❌ No net profit after gas. Skipping.");
                return null;
            }

            // Apply Slippage to Expected Output for Contract `minAmountOut`
            // Note: The slippage is applied to `finalAmountTokenA_after_V2_fees` which is already post-V2-fee.
            // The `minAmountOut` for the contract's `executeArbitrage` should be the minimum TokenA expected back *from the entire arbitrage sequence*
            // to still be profitable AFTER repaying the loan.
            // So, `minAmountOut` needs to cover `totalRepayAmount + gasCostInTokenA + tiny_profit_buffer`
            // Let's calculate minAmountOut for contract based on PROFIT AFTER SLIPPAGE
            const minAmountOutForContract = (finalAmountTokenA_after_V2_fees * BigInt(Math.floor((1 - CONFIG.SLIPPAGE_TOLERANCE) * 10000))) / 10000n;
            this.debugLog(`  Min Final Output (${tokenASymbol}, after ${CONFIG.SLIPPAGE_TOLERANCE * 100}% slippage): ${ethers.formatUnits(minAmountOutForContract, pair.decimalsA)}`);

            // Profit after considering slippage on the final output
            const profitAfterSlippageAndGas = minAmountOutForContract > (totalRepayAmount + gasCostInTokenA) ?
                minAmountOutForContract - (totalRepayAmount + gasCostInTokenA) : 0n;
            this.debugLog(`  Net Profit (${tokenASymbol}, after slippage & gas): ${ethers.formatUnits(profitAfterSlippageAndGas, pair.decimalsA)}`);


            if (profitAfterSlippageAndGas > 0n) {
                const profitAmountInTokenA = parseFloat(ethers.formatUnits(profitAfterSlippageAndGas, pair.decimalsA));
                const profitInUSD = this.estimateUSDValue(profitAmountInTokenA, pair.tokenA, pair.decimalsA);
                this.debugLog(`  Est. Profit USD: $${profitInUSD.toFixed(4)} (Min Required: $${CONFIG.MIN_PROFIT_USD})`);

                if (profitInUSD >= CONFIG.MIN_PROFIT_USD) {
                    return {
                        profitable: true,
                        profitFormatted: `${ethers.formatUnits(profitAfterSlippageAndGas, pair.decimalsA)} ${tokenASymbol} (~$${profitInUSD.toFixed(2)})`,
                        spreadPercent: spread, // Raw spread before flash loan fee
                        loanAmount,
                        minAmountOut: minAmountOutForContract, // This is the value contract expects for its own check against final output of TokenA
                        profitUSD,
                        dexUsedForHop2
                    };
                } else if (profitInUSD > CONFIG.MIN_PROFIT_USD * 0.5) { // Near miss if >50% of target
                    this.debugLog(`  💡 Near Miss: Profit $${profitInUSD.toFixed(3)} is below $${CONFIG.MIN_PROFIT_USD}`);
                    return { profitable: false, nearMiss: true, profitUSD, dexUsedForHop2 };
                }
            }
            this.debugLog("  ❌ Profit after slippage & gas is zero or less. Skipping.");
            return null;
        } catch (error) {
            if (CONFIG.DEBUG_MODE) {
                console.error(`❌ Error in checkArbitrageOpportunity for ${pair.symbol} loan ${amountStr}:`, error.message, error.stack);
            }
            return null;
        }
    }

    async getBestV2Price(amountIn, path, decimalsOut, decimalsIn) { // Added decimals for debug logging
        this.debugLog(`  getBestV2Price: Input ${ethers.formatUnits(amountIn, decimalsIn)} ${path[0]} -> ? ${path[1]}`);
        const results = await Promise.allSettled([ // Use allSettled to avoid one failing promise killing all
            { dexName: 'SushiSwap', promise: this.getV2Price(this.sushiSwap, amountIn, path, 'SushiSwap', decimalsIn, decimalsOut) },
            { dexName: 'QuickSwap', promise: this.getV2Price(this.quickSwap, amountIn, path, 'QuickSwap', decimalsIn, decimalsOut) },
            { dexName: 'KyberSwap', promise: this.getV2Price(this.kyberSwap, amountIn, path, 'KyberSwap', decimalsIn, decimalsOut) }
        ]);

        let bestPrice = 0n;
        let bestDex = 'None';

        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value > bestPrice) {
                bestPrice = result.value;
                bestDex = result.value.dexName; // The dexName was part of the original object, not result.value
                                                // Correcting: getV2Price should return { price, dexName } or pass it along
                                                // For now, let's trace it back from the input array.
                                                // Find the original input object that led to this fulfilled promise
                const originalInput = results.find(r => r.status === 'fulfilled' && r.value === bestPrice); // This logic is a bit circular.
                                                                                                        // Need to get dexName from the object that `promise` belongs to.
                                                                                                        // This part needs a slight refactor. Let's fix it by passing dexName from the objects.
            }
        });
        
        // Simpler way to get best price and dexName from allSettled results
        let finalBestPrice = 0n;
        let finalBestDex = 'None';
        for (const item of results) {
            if (item.status === 'fulfilled') {
                const {price, dexName} = item.value; // Expect getV2Price to return this structure
                if (price > finalBestPrice) {
                    finalBestPrice = price;
                    finalBestDex = dexName;
                }
            }
        }
        
        this.debugLog(`    Best V2 from ${finalBestDex || 'N/A'}: ${ethers.formatUnits(finalBestPrice, decimalsOut)} ${path[1]}`);
        return { bestPrice: finalBestPrice, dexName: finalBestDex };
    }

    async getV2Price(router, amountIn, path, dexName, decimalsIn, decimalsOut) { // Added dexName and decimals for context
        try {
            // this.debugLog(`    Querying ${dexName}: ${ethers.formatUnits(amountIn, decimalsIn)} ${path[0]} -> ? ${path[1]}`);
            const amounts = await router.getAmountsOut(amountIn, path);
            let outputAmount = amounts[amounts.length - 1];
            // this.debugLog(`      ${dexName} raw output: ${ethers.formatUnits(outputAmount, decimalsOut)} ${path[1]}`);

            // Deduct standard V2 fee (e.g., 0.3%)
            // IMPORTANT: Confirm fee for KyberSwap Classic if it differs.
            outputAmount = (outputAmount * (10000n - CONFIG.V2_STANDARD_FEE_BPS)) / 10000n;
            // this.debugLog(`      ${dexName} output after ${CONFIG.V2_STANDARD_FEE_BPS / 100n}% fee: ${ethers.formatUnits(outputAmount, decimalsOut)} ${path[1]}`);
            return { price: outputAmount, dexName: dexName}; // Return structure for getBestV2Price
        } catch (e) {
            this.debugLog(`    Error querying ${dexName} (${path[0]}->${path[1]}): ${e.message.substring(0,100)}`);
            return { price: 0n, dexName: dexName }; // Return structure even on error
        }
    }

    async getV3Price(tokenIn, tokenOut, fee, amountIn) {
        try {
            return await this.uniV3Quoter.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
        } catch (e) {
            this.debugLog(`    Error UniV3 Quoter: ${e.message.substring(0,100)}`);
            return 0n;
        }
    }

    estimateUSDValue(amount, tokenAddr, tokenDecimals) { // Added tokenDecimals for context if needed
        const addr = tokenAddr.toLowerCase();
        if (addr === '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270') return amount * CONFIG.POL_PRICE_USD; // WMATIC
        if (['0x2791bca1f2de4661ed88a30c99a7a9449aa84174',  // USDC
             '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',  // USDT
             '0x8f3cf7ad23cd3cabd9735aff958023239c6a063']   // DAI
             .includes(addr)) return amount; // Assuming 1 USD for stables
        if (addr === '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619') return amount * CONFIG.WETH_PRICE_USD; // WETH
        if (addr === '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6') return amount * CONFIG.WBTC_PRICE_USD; // WBTC
        if (addr === '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39') return amount * CONFIG.LINK_PRICE_USD; // LINK
        this.debugLog(`Warning: USD value estimation not configured for token ${tokenAddr}. Returning raw amount.`);
        return amount; // Fallback: return raw amount (interprets it as USD, which is likely wrong)
    }

    async estimateGasCostInToken(gasPrice, pair) {
        const gasCostMatic = BigInt(CONFIG.GAS_LIMIT) * gasPrice;
        if (pair.tokenA.toLowerCase() === '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270') { // WMATIC
            return gasCostMatic;
        }
        try {
            // Using SushiSwap to price MATIC in terms of pair.tokenA
            // Get rate for 1 MATIC in tokenA, then scale
            const oneMatic = ethers.parseEther('1');
            const {price: rateForOneMatic} = await this.getV2Price(this.sushiSwap, oneMatic, ['0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', pair.tokenA], 'SushiSwap (for gas est.)', 18, pair.decimalsA);

            if (rateForOneMatic > 0n) {
                return (gasCostMatic * rateForOneMatic) / oneMatic;
            }
        } catch (e) {
            this.debugLog(`    Gas cost estimation error for ${pair.symbol}: ${e.message}`);
        }
        const fallbackGas = ethers.parseUnits('0.05', pair.decimalsA);
        this.debugLog(`    Using fallback gas cost for ${pair.symbol.split('/')[0]}: ${ethers.formatUnits(fallbackGas, pair.decimalsA)}`);
        return fallbackGas;
    }

    async executeFlashLoan(pair, opp, gasPrice) {
        this.executionInProgress = true;
        const block = await this.provider.getBlockNumber();
        // Ensure protection struct members are BigInts where appropriate
        const protection = {
            maxGasPriceGwei: ethers.parseUnits(CONFIG.MAX_GAS_PRICE_GWEI.toString(), 'gwei'),
            blockNumberDeadline: BigInt(block + 10), // Increased deadline slightly
            priceCommitment: ethers.keccak256(ethers.toUtf8Bytes('stable_price_commitment_v1')), // Placeholder
            useCommitReveal: false
        };
        this.debugLog('🚀 Executing flash loan with:', { pair: pair.symbol, loanAmount: ethers.formatUnits(opp.loanAmount, pair.decimalsA), minAmountOut: ethers.formatUnits(opp.minAmountOut, pair.decimalsA), protection });

        try {
            const tx = await this.contract.executeArbitrage(
                pair.tokenA,
                pair.tokenB,
                opp.loanAmount,
                pair.uniswapFee,
                opp.minAmountOut,
                protection,
                {
                    gasLimit: CONFIG.GAS_LIMIT,
                    gasPrice: gasPrice // Already a BigInt from provider.getFeeData().gasPrice
                }
            );
            console.log(`📋 TX Submitted: ${tx.hash} for ${pair.symbol} loan ${ethers.formatUnits(opp.loanAmount, pair.decimalsA)}`);
            const receipt = await tx.wait(1); // Wait for 1 confirmation
            if (receipt && receipt.status === 1) {
                console.log(`✅ Success! Profit: ${opp.profitFormatted}. GasUsed: ${receipt.gasUsed.toString()}. TX: ${receipt.hash}`);
                // Potentially query contract events here for actual profit if logged
            } else {
                tedstatus : 'unknown'}. TX: ${receipt ? receipt.hash : tx.hash}`);
            }
        } catch (err) {
            console.error(`❌ Arbitrage execution FAILED for ${pair.symbol}:`, err.reason || err.message);
            if(err.transactionHash) console.error(`   Transaction Hash: ${err.transactionHash}`);
            // if (err.data) console.error('   Error Data:', err.data); // Can be very verbose
        } finally {
            this.executionInProgress = false;
        }
    }

    sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// Start the bot
if (!process.env.PRIVATE_KEY || !process.env.ALCHEMY_RPC_URL) {
    console.error("FATAL: Missing PRIVATE_KEY or ALCHEMY_RPC_URL in .env file. Exiting.");
    process.exit(1);
}

const bot = new FlashLoanArbitrageBot();
bot.start().catch(err => {
    console.error("FATAL: Unhandled error in bot start:", err.message, err.stack);
    process.exit(1);
});
