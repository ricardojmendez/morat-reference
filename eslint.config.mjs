import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

export default [
	{
		files: ['**/*.ts', '**/*.tsx'],
	},
	{
		ignores: [
			'.prettierrc.js',
			'**/lib',
			'**/node_modules',
			'**/migrations',
			'**/scratch',
		],
	},
	...compat.extends(
		'eslint:recommended',
		'plugin:@typescript-eslint/eslint-recommended',
		'plugin:@typescript-eslint/recommended'
	),
	{
		plugins: {},

		languageOptions: {
			globals: {
				...globals.browser,
			},

			parser: tsParser,
		},

		settings: {
			react: {
				version: 'detect',
			},
		},

		rules: {
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/ban-ts-ignore': 'off',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-explicit-any': 'off',

			'@typescript-eslint/no-unused-vars': [
				2,
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],

			'@typescript-eslint/no-var-requires': 0,
			'@typescript-eslint/no-empty-function': 0,
			'no-mixed-spaces-and-tabs': [2, 'smart-tabs'],
			'no-prototype-builtins': 'off',
			semi: 2,
		},
	},
];
