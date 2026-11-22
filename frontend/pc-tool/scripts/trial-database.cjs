const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');

const databaseRoot = process.env.XTREME1_DB_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini');
const sceneId = process.env.XTREME1_SCENE_ID || 'scene-0061';
if (!/^[a-zA-Z0-9._-]{1,120}$/.test(sceneId)) throw new Error('XTREME1_SCENE_ID must be a simple scene identifier');
const sceneRoot = path.join(databaseRoot, sceneId);
const sourceRoot = process.env.XTREME1_SOURCE_ROOT || path.join(sceneRoot, 'source');
const predictionRoot = path.join(sceneRoot, 'predictions/centerpoint-pubtracker');
const annotationRoot = path.join(sceneRoot, 'annotations');
const workingDocument = path.join(annotationRoot, `working/${sceneId}.json`);
const localPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const contentTypes = {
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.pcd': 'application/octet-stream',
};

function trusted(request) {
    const { remoteAddress, localPort, encrypted } = request.socket;
    const { host, origin } = request.headers;
    const site = request.headers['sec-fetch-site'];
    if (!localPeers.has(remoteAddress) || !host || (site && site !== 'same-origin' && site !== 'none')) return false;
    if (Object.keys(request.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'))) return false;
    const scheme = encrypted ? 'https' : 'http';
    return ['localhost', '127.0.0.1', '[::1]'].some(name => {
        if (host !== `${name}:${localPort}`) return false;
        return origin === undefined || origin === `${scheme}://${name}:${localPort}`;
    });
}

function send(response, status, body, headers = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
        ...headers,
    });
    response.end(payload);
}

function json(response, status, body) {
    send(response, status, JSON.stringify(body));
}

function readBody(request, limit = 32 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        request.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > limit) {
                reject(Object.assign(new Error('Request body exceeds storage limit'), { status: 413 }));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
        });
        request.on('error', reject);
    });
}

function atomicJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const serialized = JSON.stringify(value, null, 2) + '\n';
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, serialized, { flag: 'wx' });
    fs.renameSync(temp, file);
    return Buffer.from(serialized);
}

function safeSourcePath(urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath); }
    catch { return null; }
    const relative = decoded.replace(/^\/local-scene\/?/, '');
    if (!relative || relative.split(/[\\/]/).some(part => part === '..' || part === '.')) return null;
    const file = path.resolve(sourceRoot, relative);
    return file.startsWith(`${path.resolve(sourceRoot)}${path.sep}`) ? file : null;
}

function sendFile(request, response, file) {
    let stat;
    try { stat = fs.statSync(file); }
    catch { return json(response, 404, { error: 'Database file not found' }); }
    if (!stat.isFile()) return json(response, 404, { error: 'Database file not found' });
    response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

function validateAnnotation(value) {
    if (!value || value.version !== 3 || value.scene !== sceneId || !Array.isArray(value.frames))
        throw Object.assign(new Error(`Expected ${sceneId} annotation document version 3`), { status: 400 });
    return value;
}

function middleware(request, response, next) {
    const parsed = new URL(request.url, 'http://localhost');
    const route = parsed.pathname;
    if (route === '/local-scene' || route.startsWith('/local-scene/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Read-only source data' });
        const file = safeSourcePath(route);
        if (!file) return json(response, 400, { error: 'Invalid source path' });
        return sendFile(request, response, file);
    }

    if (!route.startsWith('/trial-data/')) return next();
    if (!trusted(request)) return json(response, 403, { error: 'Local requests only' });

    if (route === '/trial-data/centerpoint' && request.method === 'GET') {
        try {
            const pointer = JSON.parse(fs.readFileSync(path.join(predictionRoot, 'active.json'), 'utf8'));
            if (typeof pointer.runId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(pointer.runId))
                throw new Error('Invalid active run pointer');
            const result = fs.readFileSync(path.join(predictionRoot, 'runs', pointer.runId, 'tracking.json'));
            return send(response, 200, result, { 'Content-Type': 'application/json; charset=utf-8' });
        } catch { return json(response, 404, { error: 'No CenterPoint/PubTracker run is archived yet' }); }
    }

    if (route === '/trial-data/annotations' && request.method === 'GET') {
        try { return send(response, 200, fs.readFileSync(workingDocument), { 'Content-Type': 'application/json; charset=utf-8' }); }
        catch { return json(response, 404, { error: 'No working annotation document yet' }); }
    }

    if (route === '/trial-data/annotations' && request.method === 'PUT') {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || ''))
            return json(response, 415, { error: 'Expected application/json' });
        return readBody(request).then(value => {
            const document = validateAnnotation(value);
            const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
            let previous = '';
            try { previous = fs.readFileSync(workingDocument, 'utf8'); } catch {}
            if (previous !== bytes.toString('utf8')) {
                const digest = createHash('sha256').update(bytes).digest('hex');
                atomicJson(workingDocument, document);
                atomicJson(path.join(annotationRoot, 'history', `${Date.now()}-${digest.slice(0, 12)}.json`), document);
            }
            return json(response, 200, { saved: true, boxes: document.frames.reduce((count, frame) => count + frame.boxes.length, 0) });
        }).catch(error => json(response, error.status || 500, { error: error.message }));
    }

    if (route === '/trial-data/reviews' && request.method === 'GET') {
        const file = path.join(annotationRoot, 'review-decisions.json');
        try { return send(response, 200, fs.readFileSync(file), { 'Content-Type': 'application/json; charset=utf-8' }); }
        catch { return json(response, 404, { error: 'No review decisions yet' }); }
    }

    if (route === '/trial-data/reviews' && request.method === 'PUT') {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || ''))
            return json(response, 415, { error: 'Expected application/json' });
        return readBody(request, 8 * 1024 * 1024).then(value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Expected review decision map'), { status: 400 });
            atomicJson(path.join(annotationRoot, 'review-decisions.json'), value);
            return json(response, 200, { saved: true, decisions: Object.keys(value).length });
        }).catch(error => json(response, error.status || 500, { error: error.message }));
    }

    if (route === '/trial-data/annotations/archive' && request.method === 'POST') {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || ''))
            return json(response, 415, { error: 'Expected application/json' });
        return readBody(request).then(value => {
            const document = validateAnnotation(value.document);
            const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
            const digest = createHash('sha256').update(bytes).digest('hex');
            const version = `${new Date().toISOString().replace(/[:.]/g, '-')}-${digest.slice(0, 12)}`;
            atomicJson(path.join(annotationRoot, 'accepted', `${version}.json`), document);
            atomicJson(path.join(annotationRoot, 'accepted/latest.json'), {
                schema: 'xtreme1-accepted-annotation-pointer-v1', scene: sceneId, version,
                sha256: digest, acceptedAt: new Date().toISOString(), boxCount: document.frames.reduce((count, frame) => count + frame.boxes.length, 0),
            });
            return json(response, 201, { saved: true, version, sha256: digest });
        }).catch(error => json(response, error.status || 500, { error: error.message }));
    }

    return json(response, 404, { error: 'Unknown trial database endpoint' });
}

function trialDatabase() {
    const key = Symbol.for(`xtreme1.trial-database:${sceneRoot}`);
    return {
        name: 'xtreme1-local-database',
        configureServer(server) {
            if (!globalThis[key]) globalThis[key] = middleware;
            server.middlewares.use(globalThis[key]);
        },
    };
}

module.exports = { trialDatabase, middleware, databaseRoot, sceneId, sceneRoot, sourceRoot, predictionRoot, annotationRoot };
