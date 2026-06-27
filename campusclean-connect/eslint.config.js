// ESLint 9 flat config. Run `npm install` (to pull eslint) then `npm run lint`.
const globals = {
  process: 'readonly',
  __dirname: 'readonly',
  module: 'writable',
  require: 'readonly',
  console: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  Buffer: 'readonly'
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  io: 'readonly',
  L: 'readonly',
  console: 'readonly'
};

module.exports = [
  {
    ignores: ['node_modules/**', '.dist/**', 'public/uploads/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn'
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals
    }
  }
];
