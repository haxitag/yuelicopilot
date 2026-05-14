/* eslint-env node */
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    'server',
    'e2e',
    'public',
    'docs',
    '*.html',
    'clear-localstorage.html',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // 与既有大量业务代码对齐：避免 CI 被历史风格问题阻塞；关键 hooks 规则仍开启
    'no-empty': 'off',
    'no-unused-vars': 'off',
    'prefer-const': 'off',
    'no-case-declarations': 'off',
    'no-useless-escape': 'off',
    'no-useless-catch': 'off',
    'no-constant-condition': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-require-imports': 'off',
    '@typescript-eslint/no-unused-expressions': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': 'off',
  },
  overrides: [
    {
      files: ['*.config.ts', '*.config.mjs'],
      env: { node: true, browser: false },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: { browser: true },
      rules: {
        '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      },
    },
  ],
};
