/** Jest runs TypeScript through ts-jest as CommonJS (see tsconfig.jest.json). */
const base = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      // Pure logic: no database, no network.
      testMatch: [
        '<rootDir>/src/**/__tests__/**/*.test.ts',
        '<rootDir>/server/src/**/__tests__/**/*.test.ts',
      ],
    },
    {
      ...base,
      displayName: 'web',
      // React components and client helpers: jsdom + Testing Library, no browser needed.
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup-web.ts'],
    },
    {
      ...base,
      displayName: 'api',
      // HTTP + Postgres integration tests. Needs TEST_DATABASE_URL (or DATABASE_URL).
      testMatch: ['<rootDir>/server/tests/**/*.test.ts'],
    },
  ],
};
