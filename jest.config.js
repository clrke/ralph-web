/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/server/src', '<rootDir>/shared'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@claude-code-web/shared$': '<rootDir>/shared/types',
    '^@claude-code-web/shared/utils$': '<rootDir>/shared/utils',
  },
  collectCoverageFrom: [
    'server/src/**/*.ts',
    '!server/src/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
