<script lang="ts">
  import { Connection, PublicKey } from '@solana/web3.js'
  import { PieChart } from 'layerchart';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';

  interface TokenBalance {
    address: string;
    balance: number;
    percentage: number;
    error?: string;
  }

  interface TokenInfo {
    symbol: string;
    name: string;
    decimals: number;
    usdPrice: number;
    solPrice: number;
  }

  interface TokenResults {
    address: string;
    info: TokenInfo | null;
    totalSupply: number;
    balances: TokenBalance[];
    totalBalance: number;
    percentageOfSupply: number;
  }

  let tokenInfo: TokenInfo | null = null;
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  // Default values
  const DEFAULT_RPC = 'https://solana-rpc.publicnode.com';
  const DEFAULT_TOKEN = '92kxUXDsBQLy5ptGxtmH9CDYd5E6ZQynzf2eFPiUpump\nEb4orWUwSrsFcidrp5K3pWjibAJeocFyue191DhFpYkB';

  let isInitialized = false;  // Track initialization state

  // Initialize without defaults
  let walletAddresses = '';
  let connectionUrl = '';
  let tokenAddresses = '';

  // Other state variables
  let loading = false;
  let error = '';
  let individualBalances:TokenBalance[] = [];
  let duplicatesRemoved = 0;
  let tokenResults: TokenResults[] = [];

  let connection:Connection;

  // Initialize values from localStorage once mounted
  onMount(() => {
    if (browser) {
      connectionUrl = localStorage.getItem('connectionUrl') || DEFAULT_RPC;
      tokenAddresses = localStorage.getItem('tokenAddresses') || DEFAULT_TOKEN;
      walletAddresses = localStorage.getItem('walletAddresses') || '';
      isInitialized = true;
    }
  });

  // Save values whenever they change, but only in browser
  $: if (browser && isInitialized) {
    localStorage.setItem('connectionUrl', connectionUrl);
    localStorage.setItem('tokenAddresses', tokenAddresses);
    localStorage.setItem('walletAddresses', walletAddresses);
  }
    
  $: {
    // Update connection whenever URL changes
    try {
      connection = new Connection(connectionUrl || 'https://api.mainnet-beta.solana.com');
    } catch (err) {
      error = `Invalid connection URL: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function getTokenInfo(mintAddress: string): Promise<TokenInfo | null> {
    try {
      // Fetch token info and prices in parallel
      const [tokenResponse, priceResponse] = await Promise.all([
        fetch(`https://tokens.jup.ag/token/${mintAddress}`),
        fetch(`https://api.jup.ag/price/v2?ids=${mintAddress},${SOL_MINT}`)
      ]);

      if (!tokenResponse.ok || !priceResponse.ok) {
        return null;
      }
      
      // Parse both JSON responses in parallel
      const [tokenData, priceData] = await Promise.all([
        tokenResponse.json(),
        priceResponse.json()
      ]);

      const tokenPrice = Number(priceData.data[mintAddress]?.price || 0);
      const solPrice = Number(priceData.data[SOL_MINT]?.price || 0);

     return {
        symbol: tokenData.symbol || 'Unknown',
        name: tokenData.name || 'Unknown',
        decimals: tokenData.decimals || 0,
        usdPrice: tokenPrice,
        solPrice: solPrice > 0 ? tokenPrice / solPrice : 0
      };
    } catch (err) {
      console.warn('Could not fetch token info:', err);
      return null;
    }
  }

  function removeDuplicates(addresses: string[]): string[] {
    const uniqueAddresses = [...new Set(addresses)];
    duplicatesRemoved = addresses.length - uniqueAddresses.length;
    return uniqueAddresses;
  }

  async function getTotalSupply(mintAddress: string): Promise<number> {
    try {
      const mintInfo = await connection.getTokenSupply(new PublicKey(mintAddress));
      return Number(mintInfo.value.uiAmount);
    } catch (err) {
      console.error('Error fetching total supply:', err);
      throw err;
    }
  }

  async function getTokenBalance(walletAddress:string, totalSupply: number, tokenAddress: string): Promise<TokenBalance> {
    try {
      const wallet = new PublicKey(walletAddress);
      const token = new PublicKey(tokenAddress);

      // Find token account address
      const tokenAccounts = await connection.getTokenAccountsByOwner(wallet, {
        mint: token
      });

      if (tokenAccounts.value.length === 0) {
        return { 
          address: walletAddress, 
          balance: 0,
          percentage: 0
        };
      }

      let balance = 0;
      for (const tokenAccount of tokenAccounts.value) {
        const accountInfo = await connection.getTokenAccountBalance(tokenAccount.pubkey);
        balance += Number(accountInfo.value.uiAmount);
      }

      const percentage = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;

      return { address: walletAddress, balance, percentage };
    } catch (err) {
      console.error(`Error fetching balance for ${walletAddress}:`, err);
      return { 
        address: walletAddress, 
        balance: 0, 
        percentage: 0,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  function isValidPublicKey(address:string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  function getSignificantDecimals(num: number): number {
    if (num === 0) return 2;
    
    // Find first non-zero decimal place and add 4 more places
    const leadingZeros = -Math.floor(Math.log10(num));
    return leadingZeros > 0 ? leadingZeros + 4 : 2;
  }

  function formatNumber(amount: number, currency: 'USD' | 'SOL'): string {
    const decimals = getSignificantDecimals(amount);
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(amount);
  }

  function formatUSD(amount: number): string {
    return formatNumber(amount, 'USD')
  }

  function formatSOL(amount: number): string {
    return formatNumber(amount, 'SOL')
  }  

  async function checkBalances(): Promise<void> {
    if (!walletAddresses.trim()) {
      error = 'Please enter at least one wallet address';
      return;
    }

    if (!connectionUrl.trim()) {
      error = 'Please enter a connection URL';
      return;
    }

    if (!tokenAddresses.trim()) {
      error = 'Please enter at least one token address';
      return;
    }

    loading = true;
    error = '';
    duplicatesRemoved = 0;

    try {
      // Split and clean token addresses
      const tAddresses = tokenAddresses
        .split('\n')
        .map(addr => addr.trim())
        .filter(addr => addr);

      // Validate token addresses
      for (const addr of tAddresses) {
        if (!isValidPublicKey(addr)) {
          throw new Error(`Invalid token address format: ${addr}`);
        }
      }

      // Split addresses and remove empty lines
      let addresses = walletAddresses
        .split('\n')
        .map(addr => addr.trim())
        .filter((addr): addr is string => !!addr);

      // Remove duplicates and update the textarea
      addresses = removeDuplicates(addresses);
      if (duplicatesRemoved > 0) {
        walletAddresses = addresses.join('\n');
      }

      // Validate wallet addresses
      for (const addr of addresses) {
        if (!isValidPublicKey(addr)) {
          throw new Error(`Invalid wallet address format: ${addr}`);
        }
      }

      // Fetch results for each token
      const results: TokenResults[] = await Promise.all(
        tAddresses.map(async (tokenAddr) => {
          // Get token info and supply in parallel
          const [info, supply] = await Promise.all([
            getTokenInfo(tokenAddr),
            getTotalSupply(tokenAddr)
          ]);

          // Get balances for all wallets
          const balances = await Promise.all(
            addresses.map(address => getTokenBalance(address, supply, tokenAddr))
          );

          const totalBalance = balances.reduce((sum, result) => sum + result.balance, 0);
          const percentageOfSupply = supply > 0 ? (totalBalance / supply) * 100 : 0;

          return {
            address: tokenAddr,
            info,
            totalSupply: supply,
            balances,
            totalBalance,
            percentageOfSupply
          };
        })
      );

      individualBalances = []; // Clear old results
      results.forEach(result => {
        individualBalances.push(...result.balances);
      });

      tokenResults = results;
    } catch (err) {
      error = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      loading = false;
    }
  }

  function generateChartColors(count: number): string[] {
    return Array(count)
      .fill(0)
      .map((_, i) => {
        // Distribute hues evenly around the color wheel (0-360)
        const hue = (i * (360 / count)) % 360;
        // Fixed saturation and lightness for consistent vibrancy
        const saturation = 65;
        const lightness = 55;
        
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
      });
  }

  function prepareChartData(balances: TokenBalance[], totalSupply: number) {
    // Calculate total held by our wallets
    const totalHeld = balances.reduce((sum, b) => sum + b.balance, 0);
    const remainingSupply = totalSupply - totalHeld;
    
    const colors = generateChartColors(2);  // We only need 2 colors now

    return [
      {
        address: 'Total Held',
        value: totalHeld,
        fullAddress: `Total held by ${balances.length} wallets`,
        percentage: (totalHeld / totalSupply) * 100,
        color: colors[0]
      },
      {
        address: 'Remaining Supply',
        value: remainingSupply,
        fullAddress: 'Remaining supply',
        percentage: (remainingSupply / totalSupply) * 100,
        color: colors[1]
      }
    ];
  }
</script>

{#if !isInitialized}
  <div class="flex justify-center items-center min-h-screen">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>
{:else}
<div class="container mx-auto p-4 max-w-4xl">
  <h1 class="text-4xl font-bold mb-8 text-primary">SPL Token Balance Checker</h1>
  
  <div class="card bg-base-200 shadow-xl mb-8">
    <div class="card-body space-y-6">
      <div class="form-control w-full">
        <label class="label" for="connection">
          <span class="label-text">RPC Connection URL:</span>
        </label>
        <input
          type="text"
          id="connection"
          bind:value={connectionUrl}
          class="input input-bordered w-full"
          placeholder="https://api.mainnet-beta.solana.com"
        />
        <label class="label">
          <span class="label-text-alt">Leave empty to use default mainnet RPC</span>
        </label>
      </div>

      <div class="form-control w-full">
        <label class="label" for="token">
          <span class="label-text">SPL Token Addresses (one per line):</span>
        </label>
        <textarea
          id="token"
          bind:value={tokenAddresses}
          class="textarea textarea-bordered h-32 font-mono"
          placeholder="Enter SPL token addresses..."
        ></textarea>
        <label class="label">
          <span class="label-text-alt">Default: PLIE governance token</span>
        </label>
      </div>

      <div class="form-control w-full">
        <label class="label" for="wallets">
          <span class="label-text">Enter wallet addresses (one per line):</span>
        </label>
        <textarea
          id="wallets"
          bind:value={walletAddresses}
          class="textarea textarea-bordered h-32 font-mono"
          placeholder="Enter Solana wallet addresses..."
        ></textarea>
      </div>

      <button
        on:click={checkBalances}
        class="btn btn-primary w-full"
        disabled={loading}
      >
        {#if loading}
          <span class="loading loading-spinner"></span>
          Checking...
        {:else}
          Check Balances
        {/if}
      </button>

      {#if error}
        <div class="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>{error}</span>
        </div>
      {/if}

      {#if duplicatesRemoved > 0}
        <div class="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span>Removed {duplicatesRemoved} duplicate {duplicatesRemoved === 1 ? 'address' : 'addresses'} from the list.</span>
        </div>
      {/if}
    </div>
  </div>

  {#if tokenResults.length > 0}
  <div class="space-y-8">
    {#each tokenResults as result}
      <div class="card bg-base-200 shadow-xl">
        <div class="card-body p-4">
          <!-- Token Header -->
          <div class="space-y-2">
            <h3 class="card-title text-primary text-xl break-all">
              Token Results
            </h3>
            <div class="badge badge-secondary font-mono text-xs break-all">
              {result.address}
            </div>
          </div>
          
          <!-- Token Info -->
          {#if result.info}
            <div class="bg-base-300 rounded-box p-3 mt-4">
              <div class="text-base font-semibold">
                {result.info.name} ({result.info.symbol})
              </div>
              {#if result.info?.usdPrice > 0}
                <div class="text-sm opacity-75">
                  Current Price: {formatUSD(result.info.usdPrice)} / {formatSOL(result.info.solPrice)}
                </div>
              {/if}
            </div>
          {/if}
          
          <!-- Stats -->
          <div class="stats stats-vertical shadow bg-base-300 w-full mt-4">
            <div class="stat">
              <div class="stat-title">Total Supply</div>
              <div class="stat-value text-base">{result.totalSupply.toLocaleString()}</div>
              {#if result.info && result.info.usdPrice > 0}
                <div class="stat-desc whitespace-normal">
                  MC: {formatUSD(result.totalSupply * result.info.usdPrice)} / {formatSOL(result.totalSupply * result.info.solPrice)}
                </div>
              {/if}
            </div>
            
            <div class="stat">
              <div class="stat-title">Total Balance</div>
              <div class="stat-value text-base">{result.totalBalance.toLocaleString()}</div>
              {#if result.info && result.info.usdPrice > 0}
                <div class="stat-desc whitespace-normal">
                  ≈ {formatUSD(result.totalBalance * result.info.usdPrice)} / {formatSOL(result.totalBalance * result.info.solPrice)}
                </div>
              {/if}
            </div>
            
            <div class="stat">
              <div class="stat-title">Combined Percentage</div>
              <div class="stat-value text-base">{result.percentageOfSupply.toFixed(4)}%</div>
              <div class="stat-desc">of total supply</div>
            </div>
          </div>

          <!-- Pie Chart -->
          {#if result.balances.length > 0}
            {@const chartData = prepareChartData(result.balances, result.totalSupply)}
            <div class="mt-6">
              <h4 class="font-semibold text-lg mb-4">Token Distribution</h4>
              <div class="bg-base-300 rounded-box p-4 h-[300px]">
                <PieChart
                  data={chartData} 
                  key="address" 
                  value="percentage" 
                  cRange={chartData.map((d) => d.color)}
                />
              </div>
            </div>
          {/if}

          <!-- Wallet Details -->
          <div class="divider">Wallet Details</div>

          <div class="space-y-4">
            {#each result.balances as { address, balance, percentage, error: balanceError }}
              <div class="bg-base-300 rounded-box p-3">
                <div class="font-mono text-xs break-all mb-2">{address}</div>
                {#if balanceError}
                  <div class="text-error text-sm">{balanceError}</div>
                {:else}
                  <div class="space-y-1">
                    <div class="text-sm">
                      {balance.toLocaleString()} ({percentage.toFixed(4)}%)
                    </div>
                    {#if result.info && result.info.usdPrice > 0}
                      <div class="text-xs opacity-75">
                        ≈ {formatUSD(balance * result.info.usdPrice)} / {formatSOL(balance * result.info.solPrice)}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
</div>
{/if}