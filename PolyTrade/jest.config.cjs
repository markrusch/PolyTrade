/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS', // Use CommonJS for Jest compatibility
          moduleResolution: 'node',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
    // Transform ESM modules
    '^.+\\.m?js$': 'babel-jest',
  },
  // Don't ignore p-limit and yocto-queue (ESM packages)
  transformIgnorePatterns: [
    '/node_modules/(?!(p-limit|yocto-queue)/)',
  ],
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 60000,
  testPathIgnorePatterns: ['/node_modules/'],
  globals: {
    'import.meta': { url: 'file://' },
  },
};
