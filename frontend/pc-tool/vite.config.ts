const { defineConfig, mergeConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');
const path = require('path');
const fs = require('fs');
const { trialPrelabel } = require('./scripts/trial-prelabel.cjs');
const { trialDatabase } = require('./scripts/trial-database.cjs');

let localConfig = getLocalConfig();
// https://vitejs.dev/config/
const config = defineConfig({
    server: {
        port: 3200,
        // api proxy when development
        proxy: {
            '/trial-model': {
                target: 'http://127.0.0.1:3211',
                rewrite: (requestPath) => requestPath.replace(/^\/trial-model(?=\/|$)/, ''),
            },
            '/api': {
                changeOrigin: true,
                target: 'http://localhost:8190',
            },
        },
    },
    plugins: [vue(), trialDatabase(), trialPrelabel(__dirname)],
    resolve: {
        alias: [
            { find: 'pc-render', replacement: path.resolve(__dirname, './src/packages/pc-render') },
            { find: 'pc-editor', replacement: path.resolve(__dirname, './src/packages/pc-editor') },
        ],
    },
});

module.exports = mergeConfig(config, localConfig);

function getLocalConfig() {
    let file = path.resolve(__dirname, './vite.config.local.js');
    let config = {};
    if (fs.existsSync(file)) {
        try {
            config = require(file);
        } catch (e) {}
    }
    return config;
}
