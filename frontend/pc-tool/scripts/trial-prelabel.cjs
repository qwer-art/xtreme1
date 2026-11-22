const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const os = require('os');
const { createInterface } = require('readline');

const total = 39;
const interpreter = '/home/jerett/anaconda3/envs/point_pillar/bin/python';

function launchBuild(root) {
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' };
    delete env.PYTHONPATH;
    const databaseRoot = process.env.XTREME1_DB_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini');
    const sceneId = process.env.XTREME1_SCENE_ID || 'scene-0061';
    const assets = path.join(databaseRoot, sceneId, 'source');
    return spawn('/usr/bin/flock', ['-n', '-E', '75', '-F', assets, interpreter, path.join(root, 'scripts/build-centerpoint.py'), '--build'], {
        cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
}

function createRunner(root, launch = launchBuild) {
    let status = { state: 'idle', completed: 0, total };
    function start() {
        if (status.state === 'running') return false;
        const runId = randomUUID();
        status = { state: 'running', completed: 0, total, runId };
        let seen = 0;
        let lastError = '';
        const active = () => status.runId === runId && status.state === 'running';
        const fail = (error) => {
            if (active()) status = { ...status, state: 'failed', error };
        };
        try {
            const child = launch(root);
            createInterface({ input: child.stdout }).on('line', (line) => {
                const match = /^(\d+)\/39 history=\d+ /.exec(line);
                if (active() && match && Number(match[1]) === seen + 1 && seen < total) {
                    seen++;
                    status = { ...status, completed: Math.min(seen, total - 1) };
                }
            });
            createInterface({ input: child.stderr }).on('line', (line) => {
                if (line.trim()) lastError = line.trim().slice(-400);
            });
            child.once('error', (error) => fail(`CenterPoint: ${error.message}`));
            child.once('close', (code, signal) => {
                if (!active()) return;
                if (code === 0 && seen === total) {
                    status = { ...status, state: 'succeeded', completed: total };
                } else {
                    const reason = code === 75 ? 'another build holds the scene lock' :
                        code === 0 ? `only ${seen}/${total} progress lines` : `exit ${signal || code}`;
                    fail(`CenterPoint: ${reason}${lastError ? ': ' + lastError : ''}`);
                }
            });
        } catch (error) {
            fail(`CenterPoint: ${error.message}`);
        }
        return true;
    }
    return { start, status: () => ({ ...status }) };
}

const localPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function trusted(request) {
    const { remoteAddress, localPort, encrypted } = request.socket;
    const { host, origin } = request.headers;
    const site = request.headers['sec-fetch-site'];
    if (!localPeers.has(remoteAddress) || !host || (site && site !== 'same-origin' && site !== 'none')) return false;
    if (Object.keys(request.headers).some((key) => key === 'forwarded' || key.startsWith('x-forwarded-'))) return false;
    const scheme = encrypted ? 'https' : 'http';
    const defaultPort = encrypted ? 443 : 80;
    return ['localhost', '127.0.0.1', '[::1]'].some((name) => {
        if (host !== `${name}:${localPort}` && !(localPort === defaultPort && host === name)) return false;
        const authority = localPort === defaultPort ? name : `${name}:${localPort}`;
        return origin === undefined || origin === `${scheme}://${authority}`;
    });
}

function middleware(runner) {
    return (request, response, next) => {
        const route = request.url;
        if (route !== '/trial-prelabel' && !route.startsWith('/trial-prelabel/')) return next();
        function reply(code, error) {
            const body = runner.status();
            if (error) body.error = error;
            response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify(body));
        }
        if (!trusted(request)) {
            response.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return response.end(JSON.stringify({ state: 'idle', completed: 0, total, error: 'Local requests only' }));
        }
        if (route === '/trial-prelabel/status') {
            return request.method === 'GET' ? reply(200) : reply(405, 'Use GET');
        }
        if (route !== '/trial-prelabel/run') return reply(404, 'Unknown endpoint');
        if (request.method !== 'POST') return reply(405, 'Use POST');
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) {
            return reply(415, 'Expected application/json');
        }
        const chunks = [];
        let bytes = 0;
        request.on('data', (chunk) => {
            if (bytes > 1024) return;
            bytes += chunk.length;
            if (bytes > 1024) return reply(413, 'Request too large');
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (bytes > 1024) return;
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                return reply(400, 'Expected {}');
            }
            if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
                return reply(400, 'Expected {}');
            }
            if (!runner.start()) return reply(409, 'CenterPoint already running');
            return reply(202);
        });
    };
}

function trialPrelabel(root) {
    const key = Symbol.for(`xtreme1.trial-prelabel:${root}`);
    return {
        name: 'local-trial-prelabel',
        configureServer(server) {
            if (!globalThis[key]) globalThis[key] = createRunner(root);
            server.middlewares.use(middleware(globalThis[key]));
        },
    };
}

module.exports = { createRunner, middleware, trialPrelabel };