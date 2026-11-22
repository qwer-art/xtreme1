const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createServer } = require('./sustechpoints-server.cjs');
const { validateAnnotations } = require('./sustechpoints-data.cjs');
const { sceneRoot, trusted } = require('./trial-database.cjs');

function trialSustechpoints(root) {
    const sessions = new Map();
    const toolRoot = path.join(root, 'vendor/sustechpoints');
    const json = (response, status, value) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(value));
    };
    return {
        name: 'xtreme1-sustechpoints',
        configureServer(vite) {
            vite.middlewares.use((request, response, next) => {
                if (!request.url.startsWith('/sustechpoints/')) return next();
                if (!trusted(request)) return json(response, 403, { error: 'Local requests only' });
                try {
                    if (request.url === '/sustechpoints/session' && request.method === 'POST') {
                        if (!fs.existsSync(path.join(toolRoot, 'index.html'))) throw new Error('SUSTechPOINTS source directory is missing');
                        for (const [id, entry] of sessions) if (Date.now() - entry.used > 86400000) sessions.delete(id);
                        if (sessions.size >= 32) throw new Error('Too many active editing sessions');
                        const session = createServer({ sceneRoot, toolRoot, memory: true });
                        const id = randomUUID();
                        sessions.set(id, { ...session, used: Date.now() });
                        return json(response, 200, { path: `/sustechpoints/${id}/`, baseline: session.scene.document });
                    }
                    const match = /^\/sustechpoints\/([\w-]+)\/(.*)$/.exec(request.url);
                    const session = match && sessions.get(match[1]);
                    if (!session) return json(response, 404, { error: 'Editing session expired; reopen from the toolbar' });
                    session.used = Date.now();
                    if (!match[2] && request.method === 'DELETE') {
                        sessions.delete(match[1]);
                        return json(response, 200, { closed: true });
                    }
                    const prefix = `/sustechpoints/${match[1]}`;
                    if (match[2] === 'checkpoint' && request.method === 'POST') {
                        let bytes = 0;
                        const chunks = [];
                        request.on('data', chunk => {
                            bytes += chunk.length;
                            if (bytes > 16 * 1024 * 1024) request.destroy();
                            else chunks.push(chunk);
                        });
                        request.on('end', () => {
                            try {
                                const updates = JSON.parse(Buffer.concat(chunks).toString());
                                if (!Array.isArray(updates)) throw new Error('Invalid frame list');
                                for (const entry of updates) {
                                    if (entry.scene !== session.scene.meta.scene || !Object.hasOwn(session.scene.document.frames, entry.frame))
                                        throw new Error('Invalid frame');
                                    validateAnnotations(entry.annotation);
                                }
                                for (const entry of updates) session.scene.document.frames[entry.frame] = entry.annotation;
                                json(response, 200, { saved: true });
                            } catch (error) { json(response, 400, { error: error.message }); }
                        });
                        return;
                    }
                    if (!match[2] || match[2].startsWith('?')) {
                        const bootstrap = `<base href="${prefix}/"><script>
                            const prefix = ${JSON.stringify(prefix)};
                            const scoped = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? prefix + value : value;
                            const open = XMLHttpRequest.prototype.open;
                            XMLHttpRequest.prototype.open = function(method, url, ...args) { return open.call(this, method, scoped(url), ...args); };
                            const fetchOriginal = window.fetch;
                            window.fetch = (url, options) => fetchOriginal(scoped(url), options);
                            window.xtremeSave = updates => parent.xtremeSustechSave(window, updates);
                        </script>`;
                        const html = fs.readFileSync(path.join(toolRoot, 'index.html'), 'utf8')
                            .replace('<head>', '<head>' + bootstrap).replaceAll('="/static/', `="${prefix}/static/`);
                        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                            'Content-Security-Policy': "frame-ancestors 'self'" });
                        return response.end(html);
                    }
                    request.url = '/' + match[2];
                    session.server.emit('request', request, response);
                } catch (error) { json(response, 400, { error: error.message }); }
            });
        },
    };
}

module.exports = { trialSustechpoints };