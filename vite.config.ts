import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
	plugins: [sveltekit(), nodePolyfills()],
	optimizeDeps: {
		include: ['@solana/web3.js', '@solana/spl-token']
	}
});
