const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xtreme1-db-test-'));
process.env.XTREME1_DB_ROOT = path.join(temp, 'db');
process.env.XTREME1_SOURCE_ROOT = path.join(temp, 'source');
const database = require('../scripts/trial-database.cjs');

async function main() {
    fs.mkdirSync(database.sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(database.sourceRoot, 'index.json'), '{"scene":"scene-0061"}\n');
    const runId = 'test-run';
    const runDir = path.join(database.predictionRoot, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'tracking.json'), JSON.stringify({ model: 'CenterPoint', scene: 'scene-0061', frames: {} }));
    fs.writeFileSync(path.join(database.predictionRoot, 'active.json'), JSON.stringify({ runId, tracking: 'tracking.json' }));

    const server = http.createServer((request, response) => database.middleware(request, response, () => {
        response.writeHead(404).end();
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        let response = await fetch(`${origin}/local-scene/index.json`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).scene, 'scene-0061');
        response = await fetch(`${origin}/trial-data/centerpoint`);
        assert.equal((await response.json()).model, 'CenterPoint');

        const document = { version: 3, scene: 'scene-0061', geometry: {}, frames: [] };
        response = await fetch(`${origin}/trial-data/annotations`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(document),
        });
        assert.equal(response.status, 200);
        response = await fetch(`${origin}/trial-data/annotations`);
        assert.deepEqual(await response.json(), document);
        assert.equal(fs.readdirSync(path.join(database.annotationRoot, 'history')).length, 1);

        response = await fetch(`${origin}/trial-data/reviews`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: '{"decision":"accepted"}' }),
        });
        assert.equal(response.status, 200);
        response = await fetch(`${origin}/trial-data/reviews`);
        assert.equal((await response.json()).item, '{"decision":"accepted"}');

        response = await fetch(`${origin}/trial-data/annotations/archive`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document }),
        });
        assert.equal(response.status, 201);
        const archived = await response.json();
        assert.equal(JSON.parse(fs.readFileSync(path.join(database.annotationRoot, 'accepted/latest.json'))).version, archived.version);
        assert.equal(fs.existsSync(path.join(database.annotationRoot, 'accepted', `${archived.version}.json`)), true);

        const boundary = await new Promise((resolve, reject) => {
            const request = http.request({ hostname: '127.0.0.1', port: server.address().port,
                path: '/local-scene/%2e%2e%2ftrial-data%2fannotations', method: 'GET' }, result => {
                result.resume(); result.on('end', () => resolve(result.statusCode));
            });
            request.on('error', reject);
            request.end();
        });
        assert.equal(boundary, 400);
        console.log('PASS database static source, current inference, working annotations, review decisions, accepted snapshot and path boundary');
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error.stack || error.message);
    fs.rmSync(temp, { recursive: true, force: true });
    process.exitCode = 1;
});
