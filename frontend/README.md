# Roshni FSM Console

React + Vite front end for the voice-flow engine: a live test console, a script library, and a visual flow builder that writes `states.json`-compatible scripts.

```
npm install
npm run dev        # http://localhost:5173/fsm/
npm run build
```
Set `VITE_API_URL` (default `http://localhost:8000/api`).

## Structure
```
src/
  main.jsx · App.jsx            bootstrap + hash router (#/test, #/scripts, #/builder[/name])
  api/client.js                 the only file that calls fetch()
  hooks/                        useSession, useActiveScript, useDraft (undo/redo), useRoute
  lib/                          pure logic, no React: script model + mutations, validate, graph, walk, events
  components/                   TopBar, form fields
  views/console/                live test console (conversation, inspector, side panel)
  views/scripts/                script library (open, duplicate, activate, import/export)
  views/builder/                flow builder (canvas, state inspector, slots, lanes/groups, intents, settings, preview)
  styles/                       console.css (original four sheets merged, same order), base.css, builder.css
```

## Backend contract used
`GET /states` · `GET /customers` · `POST /session` · `POST /session/reset` · `POST /turn` · `POST /session/end`
`GET /scripts` · `GET|POST /scripts/:name` · `GET /scripts/active` · `POST /scripts/active/:name`

The builder saves one extra top-level key, `_layout` (canvas x/y per state). If your backend rejects unknown keys,
strip it in the save handler; positions are also mirrored in localStorage and fall back to a lane-column auto-layout.
