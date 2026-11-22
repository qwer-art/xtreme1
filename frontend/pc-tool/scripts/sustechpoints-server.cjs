const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { loadScene, validateAnnotations } = require('./sustechpoints-data.cjs');

function createServer({ sceneRoot, toolRoot = path.resolve(__dirname, '../vendor/sustechpoints'), output, threshold = 0.5, memory = false }) {
    const scene = loadScene(sceneRoot, threshold, process.env.XTREME1_SOURCE_ROOT);
    const sceneId = scene.meta.scene;
    output ||= path.join(sceneRoot, 'annotations/sustechpoints', scene.document.predictionRun, 'working.json');
    if (!memory) {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        if (!fs.existsSync(output)) fs.writeFileSync(output, JSON.stringify(scene.document, null, 2) + '\n', { flag: 'wx' });
    }
    let document = memory ? scene.document : JSON.parse(fs.readFileSync(output, 'utf8'));
    if (document.scene !== sceneId || document.predictionRun !== scene.document.predictionRun ||
        JSON.stringify(document.scanIds) !== JSON.stringify(scene.document.scanIds)) throw new Error('Saved review belongs to another scene or run');
    Object.values(document.frames).forEach(validateAnnotations);
    const sources = new Map();
    for (const frame of scene.frames) {
        const prefix = `/data/${sceneId}`;
        sources.set(`${prefix}/lidar/${frame.timestamp}.pcd`, path.join(scene.source, frame.cloud));
        for (const image of frame.images) sources.set(`${prefix}/camera/${image.channel}/${frame.timestamp}.jpg`, path.join(scene.source, image.path));
    }
    const json = (response, value, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(value));
    };
    const known = (name, frame) => {
        if (name !== sceneId || (frame !== undefined && !Object.hasOwn(document.frames, frame))) throw new Error('Unknown scene or frame');
    };
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg',
        '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
    const server = http.createServer(async (request, response) => {
        try {
            const authority = `127.0.0.1:${request.socket.localPort}`;
            if (request.headers.host !== authority || (request.headers.origin && request.headers.origin !== `http://${authority}`) ||
                !['same-origin', 'none', undefined].includes(request.headers['sec-fetch-site'])) return json(response, { error: 'Local origin only' }, 403);
            const url = new URL(request.url, `http://${authority}`);
            const route = decodeURIComponent(url.pathname);
            const name = url.searchParams.get('scene'), frame = url.searchParams.get('frame');
            let body;
            if (request.method === 'POST') {
                let bytes = 0;
                const chunks = [];
                for await (const chunk of request) {
                    bytes += chunk.length;
                    if (bytes > 16 * 1024 * 1024) throw new Error('Request too large');
                    chunks.push(chunk);
                }
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } else if (!['GET', 'HEAD'].includes(request.method)) return json(response, { error: 'Method not allowed' }, 405);
            if (route === '/saveworldlist' && request.method === 'POST') {
                if (memory) return json(response, { error: 'Save through the annotation workbench' }, 409);
                if (!Array.isArray(body) || !body.length || body.length > scene.frames.length) throw new Error('Invalid frame list');
                const updates = {};
                for (const entry of body) {
                    known(entry.scene, entry.frame);
                    if (Object.hasOwn(updates, entry.frame)) throw new Error('Duplicate frame');
                    updates[entry.frame] = validateAnnotations(entry.annotation);
                }
                const updated = { ...document, frames: { ...document.frames, ...updates } };
                const temp = `${output}.${randomUUID()}.tmp`;
                fs.writeFileSync(temp, JSON.stringify(updated, null, 2) + '\n', { flag: 'wx' });
                fs.renameSync(temp, output);
                document = updated;
                console.log(`saved ${Object.keys(updates).length} frames -> ${output}`);
                return json(response, 'ok');
            }
            if (route === '/loadworldlist' && request.method === 'POST') {
                if (!Array.isArray(body)) throw new Error('Invalid frame list');
                return json(response, body.map(entry => { known(entry.scene, entry.frame);
                    return { ...entry, annotation: document.frames[entry.frame] }; }));
            }
            if (request.method === 'POST') return json(response, { error: 'Use CenterPoint/PubTracker for pre-annotation; manual editing is available' }, 501);
            if (route === '/get_all_scene_desc') return json(response, { [sceneId]: { scene: sceneId, source: 'CenterPoint + PubTracker' } });
            if (route === '/datameta') return json(response, [scene.meta]);
            if (route === '/export') {
                response.setHeader('Content-Disposition', `attachment; filename="${sceneId}-sustechpoints.json"`);
                return json(response, document);
            }
            if (['/scenemeta', '/load_annotation', '/load_ego_pose', '/objs_of_scene', '/checkscene'].includes(route)) {
                known(name, frame ?? undefined);
                if (route === '/scenemeta') return json(response, scene.meta);
                if (route === '/load_annotation') return json(response, document.frames[frame]);
                if (route === '/load_ego_pose') return json(response, null);
                if (route === '/checkscene') {
                    Object.values(document.frames).forEach(validateAnnotations);
                    return json(response, []);
                }
                const objects = new Map();
                for (const boxes of Object.values(document.frames)) for (const box of boxes) {
                    const key = `${box.obj_type}:${box.obj_id}`;
                    const old = objects.get(key);
                    objects.set(key, { category: box.obj_type, id: box.obj_id, count: (old?.count || 0) + 1 });
                }
                return json(response, [...objects.values()]);
            }
            if (route === '/' && !name) {
                response.writeHead(302, { Location: `/?scene=${encodeURIComponent(sceneId)}&frame=${scene.meta.frames[0]}` });
                return response.end();
            }
            const label = /^\/data\/([^/]+)\/label\/([^/]+)\.json$/.exec(route);
            if (label) { known(label[1], label[2]); return json(response, document.frames[label[2]]); }
            let file = sources.get(route);
            if (!file && route === '/') file = path.join(toolRoot, 'index.html');
            if (!file && route.startsWith('/static/')) {
                const base = path.resolve(toolRoot, 'public');
                const candidate = path.resolve(base, route.slice('/static/'.length));
                if (candidate.startsWith(base + path.sep)) file = candidate;
            }
            if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(response, { error: 'Not found' }, 404);
            response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            if (request.method === 'HEAD') return response.end();
            fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
        } catch (error) { json(response, { error: error.message }, 400); }
    });
    return { server, scene, output };
}

if (require.main === module) {
    const sceneRoot = path.join(process.env.XTREME1_DB_ROOT || path.join(os.homedir(), 'datasets/perception/xtreme1/nuscenes-v1.0-mini'),
        process.env.XTREME1_SCENE_ID || 'scene-0061');
    const { server, scene, output } = createServer({ sceneRoot, output: process.env.SUSTECHPOINTS_OUTPUT });
    const port = Number(process.env.SUSTECHPOINTS_PORT || 3202);
    server.listen(port, '127.0.0.1', () => console.log(`SUSTechPOINTS http://127.0.0.1:${port}/ | ${scene.frames.length} frames | ${output}`));
}

module.exports = { createServer };