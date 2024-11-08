import type { Config } from 'tailwindcss';

export default {
	content: [
		'./src/**/*.{html,js,svelte,ts}',
		'./node_modules/layerchart/**/*.{svelte,js}'
	],

	theme: {
		extend: {
			colors: {
			  'surface-100': 'oklch(var(--b1) / <alpha-value>)',
			  'surface-200': 'oklch(var(--b2) / <alpha-value>)',
			  'surface-300': 'oklch(var(--b3) / <alpha-value>)',
			  'surface-content': 'oklch(var(--bc) / <alpha-value>)',
			}
		},
	},

	plugins: [
		require('daisyui'),
	]
} satisfies Config;
