const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const node = process.execPath;
const vite = path.join(root, 'node_modules/vite/bin/vite.js');
const database = fs.mkdtempSync(path.join(os.tmpdir(), 'xtreme1-trial-e2e-'));
const source = process.env.XTREME1_SOURCE_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061/source');
const env = { ...process.env, XTREME1_DB_ROOT: database, XTREME1_SOURCE_ROOT: source };
const formalDatabase = process.env.XTREME1_DB_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini');
let server;

function freePort() {
    return new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', () => {
            const { port } = listener.address();
            listener.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitReady(url) {
    const deadline = Date.now() + 15000;
    let lastError;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error(`Vite exited with ${server.exitCode}`);
        try {
            const response = await fetch(url);
            if (response.ok && (await response.text()).includes('Point Cloud Tool - Xtreme1')) return;
        } catch (error) { lastError = error; }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Vite did not become ready: ${lastError || url}`);
}

function verifyDatabase() {
    const scene = path.join(database, 'scene-0061');
    const working = JSON.parse(fs.readFileSync(path.join(scene, 'annotations/working/scene-0061.json')));
    const reviews = JSON.parse(fs.readFileSync(path.join(scene, 'annotations/review-decisions.json')));
    const latest = JSON.parse(fs.readFileSync(path.join(scene, 'annotations/accepted/latest.json')));
    const accepted = JSON.parse(fs.readFileSync(path.join(scene, `annotations/accepted/${latest.version}.json`)));
    const boxCount = working.frames.reduce((count, frame) => count + frame.boxes.length, 0);
    if (!boxCount || accepted.frames.reduce((count, frame) => count + frame.boxes.length, 0) !== boxCount)
        throw new Error('working and accepted annotation snapshots differ');
    if (!Object.keys(reviews).length) throw new Error('review decisions were not persisted');
    if (!fs.existsSync(path.join(scene, 'annotations/history'))) throw new Error('working history is missing');
    console.log(`DATABASE PASS: ${boxCount} saved boxes, ${Object.keys(reviews).length} review decisions, accepted=${latest.version}`);
}

async function stopServer() {
    if (!server || server.exitCode !== null) return;
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
}

async function main() {
    if (!fs.existsSync(path.join(source, 'index.json'))) throw new Error(`Missing database source manifest: ${source}`);
    const formalRuns = path.join(formalDatabase, 'scene-0061/predictions/centerpoint-pubtracker');
    const active = JSON.parse(fs.readFileSync(path.join(formalRuns, 'active.json')));
    const sourceRun = path.join(formalRuns, 'runs', active.runId);
    const fixtureRun = path.join(database, 'scene-0061/predictions/centerpoint-pubtracker/runs', active.runId);
    fs.mkdirSync(path.dirname(fixtureRun), { recursive: true });
    fs.cpSync(sourceRun, fixtureRun, { recursive: true });
    fs.mkdirSync(path.dirname(path.join(database, 'scene-0061/predictions/centerpoint-pubtracker/active.json')), { recursive: true });
    fs.writeFileSync(path.join(database, 'scene-0061/predictions/centerpoint-pubtracker/active.json'), JSON.stringify(active) + '\n');
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/local-trial`;
    server = spawn(node, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env, stdio: 'ignore' });
    await waitReady(url);
    const result = spawnSync(node, [path.join(root, 'tests/centerpoint-trial.cjs')], {
        cwd: root,
        env: { ...env, TRIAL_URL: url, TRIAL_SCREENSHOT: path.join(database, 'verification.png') },
        stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`Browser database regression failed: ${result.status}`);
    verifyDatabase();
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
}).finally(async () => {
    await stopServer();
    fs.rmSync(database, { recursive: true, force: true });
});
