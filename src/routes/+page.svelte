<script lang="ts">
  import { Connection, PublicKey } from '@solana/web3.js'
  import type { ParsedAccountData } from '@solana/web3.js';
  import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
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
  const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
  const DEFAULT_TOKEN = '92kxUXDsBQLy5ptGxtmH9CDYd5E6ZQynzf2eFPiUpump';

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
</script>

{#if !isInitialized}
  <div class="flex justify-center items-center min-h-screen">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
  </div>
{:else}
<div class="container mx-auto p-4 max-w-2xl">
  <h1 class="text-2xl font-bold mb-4">SPL Token Balance Checker</h1>
  
  <div class="mb-4">
    <label for="connection" class="block mb-2">
      RPC Connection URL:
    </label>
    <input
      type="text"
      id="connection"
      bind:value={connectionUrl}
      class="w-full p-2 border rounded"
      placeholder="https://api.mainnet-beta.solana.com"
    />
    <p class="text-sm text-gray-600 mt-1">
      Leave empty to use default mainnet RPC
    </p>
  </div>

  <div class="mb-4">
    <label for="token" class="block mb-2">
      SPL Token Addresses (one per line):
    </label>
    <textarea
      id="token"
      bind:value={tokenAddresses}
      class="w-full h-32 p-2 border rounded font-mono"
      placeholder="Enter SPL token addresses..."
    ></textarea>
    <p class="text-sm text-gray-600 mt-1">
      Default: PLIE governance token
    </p>
  </div>

  <div class="mb-4">
    <label for="wallets" class="block mb-2">
      Enter wallet addresses (one per line):
    </label>
    <textarea
      id="wallets"
      bind:value={walletAddresses}
      class="w-full h-32 p-2 border rounded font-mono"
      placeholder="Enter Solana wallet addresses..."
    ></textarea>
  </div>

  <button
    on:click={checkBalances}
    class="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
    disabled={loading}
  >
    {loading ? 'Checking...' : 'Check Balances'}
  </button>

  {#if error}
    <div class="mt-4 p-2 bg-red-100 text-red-700 rounded">
      {error}
    </div>
  {/if}

  {#if duplicatesRemoved > 0}
    <div class="mt-4 p-2 bg-blue-100 text-blue-700 rounded">
      Removed {duplicatesRemoved} duplicate {duplicatesRemoved === 1 ? 'address' : 'addresses'} from the list.
    </div>
  {/if}

  {#if tokenResults.length > 0}
  <div class="mt-6 space-y-8">
    {#each tokenResults as result}
      <div class="border rounded-lg p-4 bg-white shadow-sm">
        <h3 class="text-xl font-semibold mb-4">Results for Token: {result.address}</h3>
        
        {#if result.info}
        <div class="mb-4 p-3 bg-gray-50 rounded-lg border">
            <div class="text-sm text-gray-600 mt-1">
              {result.info.name} ({result.info.symbol})
            </div>
            {#if result.info.usdPrice > 0}
              <div class="text-sm text-gray-600 mt-1">
                Current Price: {formatUSD(result.info.usdPrice)} / {formatSOL(result.info.solPrice)}
              </div>
            {/if}
        </div>
        {/if}
        
        <div class="mb-4 space-y-2">
          <div>
            <strong>Total Supply:</strong> {result.totalSupply.toLocaleString()} tokens
            {#if result.info && result.info.usdPrice > 0}
              <div class="text-sm text-gray-600">
                MC: {formatUSD(result.totalSupply * result.info.usdPrice)} / {formatSOL(result.totalSupply * result.info.solPrice)}
              </div>
            {/if}
          </div>
          <div>
            <strong>Total Balance:</strong> {result.totalBalance.toLocaleString()} tokens
            {#if result.info && result.info?.usdPrice > 0}
              <div class="text-sm text-gray-600">
                ≈ {formatUSD(result.totalBalance * result.info.usdPrice)} / {formatSOL(result.totalBalance * result.info.solPrice)}
              </div>
            {/if}
          </div>
          <div>
            <strong>Combined Percentage:</strong> {result.percentageOfSupply.toFixed(4)}% of total supply
          </div>
        </div>

        <div class="border rounded">
          {#each result.balances as { address, balance, percentage, error: balanceError }}
            <div class="p-2 border-b last:border-b-0">
              <div class="font-mono text-sm break-all">{address}</div>
              {#if balanceError}
                <div class="text-red-600 text-sm">{balanceError}</div>
              {:else}
                <div class="text-sm">
                  {balance.toLocaleString()} tokens ({percentage.toFixed(4)}% of supply)
                  {#if result.info && result.info?.usdPrice > 0}
                    <div class="text-gray-600">
                      ≈ {formatUSD(balance * result.info.usdPrice)} / {formatSOL(balance * result.info.solPrice)}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
  {/if}
  </div>
  {/if}