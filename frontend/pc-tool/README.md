## Introduction

Point cloud annotation tool of Xtreme1, developed width Vue 3 + Typescript + Vite.

## Development
Install required  dependencies

```bash
npm install
```

Set proxy config in `vite.config.ts`

```javascript
// api proxy when development
proxy: {
    '/api': {
        changeOrigin: true,
        target: 'api address',
    },
},
```

Start the development server

```bash
npm run dev
```

Build

```bash
npm run build
```

## Local Single-Frame Trial

With dependencies installed and the scene-0061 assets under `public/local-frame/`, run:

```bash
cd /home/jerett/catkin_ws/src/xtreme1/frontend/pc-tool
npm run dev -- --host 127.0.0.1 --port 3200 --strictPort
```

Open http://127.0.0.1:3200/local-trial. Select Car, Pedestrian or Cyclist in Instances,
click **Create Box(3D)** and click three points in the main point-cloud view.
Click **Save** before refreshing. Labels use the native object format and stay in this
browser's localStorage, keyed by sample token. Use the same host, port and browser profile
to reopen them. This development-only URL requires no backend or login.

## Related Information

- [Camera parameter](./docs/camera_config.md)
