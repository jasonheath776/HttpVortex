"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
exports.default = (0, config_1.defineConfig)({
    test: {
        include: ['src/test/**/*.test.ts'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/test/**', 'src/extension.ts', 'src/*Panel.ts', 'src/credentialsPanel.ts'],
        },
    },
});
//# sourceMappingURL=vitest.config.js.map