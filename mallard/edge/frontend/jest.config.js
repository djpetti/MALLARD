module.exports = {
    preset: "ts-jest/presets/js-with-babel",
    testEnvironment: 'jest-environment-jsdom-sixteen',
    testRegex: 'src/.*test/test_.*\\.(ts|tsx)$',
    moduleFileExtensions: ['ts', 'js'],
    transformIgnorePatterns: [
        "node_modules/(?!(lit-element|lit-html|@material)/)"
    ],
    collectCoverageFrom: [
        "src/**/{!(index|elements|element-test-utils),}.ts",
    ],
    globals: {
        // This is normally set in HTML by the web server. For testing,
        // it needs to be set manually.
        API_BASE_URL: "http://mallard/testapi/v1/",
    }
};
