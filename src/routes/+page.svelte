<script lang="ts">
  import { Connection, PublicKey } from '@solana/web3.js'
  import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';

  interface TokenBalance {
    address: string;
    balance: number;
    percentage: number;
    error?: string;
  }

  // Default values
  const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
  const DEFAULT_TOKEN = '92kxUXDsBQLy5ptGxtmH9CDYd5E6ZQynzf2eFPiUpump';

  let isInitialized = false;  // Track initialization state

  // Initialize without defaults
  let walletAddresses = '';
  let connectionUrl = '';
  let tokenAddress = '';

  // Other state variables
  let totalBalance = 0;
  let loading = false;
  let error = '';
  let individualBalances:TokenBalance[] = [];
  let totalSupply = 0;
  let percentageOfSupply = 0;

  let connection:Connection;

  // Initialize values from localStorage once mounted
  onMount(() => {
    if (browser) {
      connectionUrl = localStorage.getItem('connectionUrl') || DEFAULT_RPC;
      tokenAddress = localStorage.getItem('tokenAddress') || DEFAULT_TOKEN;
      walletAddresses = localStorage.getItem('walletAddresses') || '';
      isInitialized = true;
    }
  });

  // Save values whenever they change, but only in browser
  $: if (browser && isInitialized) {
    localStorage.setItem('connectionUrl', connectionUrl);
    localStorage.setItem('tokenAddress', tokenAddress);
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

  async function getTotalSupply(mintAddress: string): Promise<number> {
    try {
      const mintInfo = await connection.getTokenSupply(new PublicKey(mintAddress));
      return Number(mintInfo.value.uiAmount);
    } catch (err) {
      console.error('Error fetching total supply:', err);
      throw err;
    }
  }

  async function getTokenBalance(walletAddress:string, totalSupply: number): Promise<TokenBalance> {
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

  async function checkBalances(): Promise<void> {
    if (!walletAddresses.trim()) {
      error = 'Please enter at least one wallet address';
      return;
    }

    if (!connectionUrl.trim()) {
      error = 'Please enter a connection URL';
      return;
    }

    if (!tokenAddress.trim()) {
      error = 'Please enter a token address';
      return;
    }

    if (!isValidPublicKey(tokenAddress)) {
      error = 'Invalid token address format';
      return;
    }

    loading = true;
    error = '';
    totalBalance = 0;
    totalSupply = 0;
    percentageOfSupply = 0;

    try {
      // Get total supply first
      totalSupply = await getTotalSupply(tokenAddress);

      // Split addresses and remove empty lines
      const addresses = walletAddresses
        .split('\n')
        .map(addr => addr.trim())
        .filter((addr): addr is string => !!addr);

      // Validate wallet addresses
      for (const addr of addresses) {
        if (!isValidPublicKey(addr)) {
          throw new Error(`Invalid wallet address format: ${addr}`);
        }
      }

      // Fetch all balances in parallel
      const results = await Promise.all(
        addresses.map(address => getTokenBalance(address, totalSupply))
      );

      individualBalances = results;
      totalBalance = results.reduce((sum, result) => sum + result.balance, 0);
      percentageOfSupply = totalSupply > 0 ? (totalBalance / totalSupply) * 100 : 0;
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
      SPL Token Address:
    </label>
    <input
      type="text"
      id="token"
      bind:value={tokenAddress}
      class="w-full p-2 border rounded font-mono"
      placeholder="Enter SPL token address..."
    />
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

  {#if individualBalances.length > 0}
    <div class="mt-6">
      <h2 class="text-xl font-semibold mb-2">Results:</h2>
      
      <div class="mb-4 space-y-2">
        <div>
          <strong>Total Supply:</strong> {totalSupply.toLocaleString()} tokens
        </div>
        <div>
          <strong>Total Balance:</strong> {totalBalance.toLocaleString()} tokens
        </div>
        <div>
          <strong>Combined Percentage:</strong> {percentageOfSupply.toFixed(4)}% of total supply
        </div>
      </div>

      <div class="border rounded">
        {#each individualBalances as { address, balance, percentage, error: balanceError }}
          <div class="p-2 border-b last:border-b-0">
            <div class="font-mono text-sm break-all">{address}</div>
            {#if balanceError}
              <div class="text-red-600 text-sm">{balanceError}</div>
            {:else}
              <div class="text-sm">
                {balance.toLocaleString()} tokens ({percentage.toFixed(4)}% of supply)
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
{/if}