import globals from 'globals';
import pluginJs from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
	{languageOptions: {globals: globals.node}},
	// Scripts that run in the browser.
	{files: ['src/public/**/*.js'], languageOptions: {globals: globals.browser}},
	pluginJs.configs.recommended,
	eslintConfigPrettier,
];
