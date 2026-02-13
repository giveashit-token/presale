module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2020',  // ES2020 supports BigInt
        lib: ['ES2020'],
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
      }
    }]
  },
  transformIgnorePatterns: ['node_modules/(?!(litesvm)/)'],
};
