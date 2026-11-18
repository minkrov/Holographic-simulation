# Orion Workbench · engineering plan

**Implementation companion · 18 November 2026**

[Research, workflow, and visual target →](orion-workbench.md)

## Running implementation

The single-user desktop workbench is implemented; [README](../README.md) has launch and review instructions. The rest of this document records the design and the gates for expansion. In the running version:

- React and Three.js run in the browser. A worker validates static GLB/STL, and IndexedDB holds projects, sources, and sessions. Publication of an imported asset and its original file uses one transaction with a checkpoint check. The Node server does not receive or persist geometry. The SQLite, native-worker, and event-stream design below is for a possible service-backed edition, not a prerequisite or a claim about the current build.
- The local intent grammar and optional HTTP connector produce the same typed plans. Readouts come from model geometry. Only explicit approval writes a pinned review; a stale proposal must be refreshed or discarded. For user-defined comparison points, the user confirms correspondence between the two point pairs. No automatic fit or feature matching is implied.
- Software-rendered Chromium tests exercise the workflow. Daily-machine performance, wider asset and browser testing, real Orion compatibility, and spatial usability still need the separate validation gates below.

**Connector contract used by this build:** Set `ORION_ENDPOINT` on the server to an HTTPS endpoint (loopback HTTP is allowed for development). `ORION_LABEL` is optional; `ORION_TOKEN` can authorize the server's outbound request. By default, this connector is exposed only on the loopback origin. Do not enable `ORION_ALLOW_NONLOCAL=1` except behind trusted, authenticated infrastructure. The browser opt-in is bound to the displayed destination origin.

The server sends a JSON `POST` with the following keys. Missing labels become empty strings. No source files, screenshots, or history are sent.

```json
{
  "schema": 1,
  "intent": "Compare the pinned revisions and prepare a review view.",
  "scope": {
    "asset": "Enclosure", "part": "Mount plate", "current": "r07", "baseline": "r06",
    "hasMeasurement": true, "scaleConfirmed": true
  },
  "allowedActions": ["inspect", "measure", "compare", "review", "view", "help"]
}
```

Return an action such as `{"action":"review"}` or `{"action":"view","preset":"top"}`. The camera presets are `iso`, `front`, `top`, `right`, and `back`. Unknown actions fail; extra fields do not grant access to any operation. The local app calculates evidence and asks for approval on a proposed review. The connector request is size-limited, cancellable and timed out; it is not a streaming agent interface.

---

## Original engineering plan

Start single-user, on the owner’s daily workstation. The workbench owns project data and tool permissions; Orion owns language and dialogue. A disconnected Orion must not take the viewport or project offline.

## 1. Technical shape

```text
   keyboard / pointer          prompt / optional push-to-talk
           │                               │
           ▼                               ▼
   Command registry ──────► Workbench service ◄─────► Orion adapter
           │                    │   │                 intent + typed calls
           ▼                    │   └──► Import / geometry workers
   UI + scene projection ◄─────┤               │
           │                    └──► SQLite + original/derived blobs
           ├──► WebGL2 monitor (authoritative editing surface)
           └──► Optional presentation-only XR or multiview output
```

- **UI:** TypeScript, React and regular DOM with CSS Grid and system-scale typography, served locally in a desktop browser. Vite for development. Use a single Three.js canvas behind a renderer boundary. Three.js provides a WebGL2 renderer, clipping planes, a glTF loader and orbit controls. Use vanilla Three.js in the viewport module; don’t put per-frame camera state or a full scene graph into React. [1](https://threejs.org/docs/pages/WebGLRenderer.html) [3](https://threejs.org/docs/pages/GLTFLoader.html) [2](https://threejs.org/docs/pages/OrbitControls.html)
- **Why not a literal terminal?** Terminal graphics protocols such as Kitty can carry raster images, but availability is terminal-dependent and pixel transport doesn’t give us native 3D picking, scrolling overlays, or a semantic focus tree. Start with the feel and ergonomics of a TUI, not a browser pretending to run a shell. If it proves useful, add a thin CLI for project search, imports, job status and opening a saved view; same contracts, no second renderer. [1](https://sw.kovidgoyal.net/kitty/graphics-protocol/)
- **Local service:** One Node/TypeScript process serves the app and same-origin `/api/v1` endpoints. Keep asset processing off the request/UI thread; isolate untrusted native decoders or converters in restricted worker **processes**, not merely JS threads. SQLite stores versioned entities and transactions; bytes live under app data keyed by content hash. Write validated bytes through a staging path, promote by atomic rename, then publish database references in a transaction. On restart reap incomplete imports and unreferenced staged blobs; never publish a ready row pointing at an unfinished file. No auth tokens or source models in Git. An Arena demo, if needed, uses fixtures and a dummy adapter via same-origin proxy; real deployment is local-only until an explicit network/auth boundary is designed.
- **Integration:** Keep one `OrionAdapter` interface (`capabilities`, `run`, `cancel` with versioned request/events). First use fixtures that produce reproducible clarification, evidence, denial and cancellation. Then map the real Orion transport once known. Keep provider keys and any Orion endpoint credentials server-side. No dependency on a specific LLM or always-on connection. Give the agent scoped tools, not filesystem access or browser automation.
- **Rendering fallbacks:** If WebGL2 is unavailable or context is lost, list, inspect metadata, and read/save notes via the DOM; show a last saved snapshot if present. On restoration rebuild derived GPU state from the model and view description; don’t remount the project. Before packaging anything native, validate on the owner’s OS/browser and one other desktop engine. Prefer a documented launch command over desktop packaging in the pilot.

### Store the project, not the canvas

| Record | What persists / why |
| --- | --- |
| `Project` / `ProjectRevision` | Stable project identity; monotonic version for durable writes; append-only change entries. Camera orbit and transient selection do not increment the version. |
| `AssetRevision` | `assetId`, immutable `revisionId`, source hash, derived hash, importer version/options, axis/unit normalization, scale state, part map, warnings, provenance. Identical bytes can be deduped without losing source/licence records. |
| `PartRef` / `AnchorRef` | Revision plus instance/node identity; use indexed source paths or verified authored IDs, not display names. For clicked mesh points use primitive + triangle + barycentric coords or an equivalent model-local point; for authored points retain datum ID and coordinates. Don’t silently remap after a reimport. |
| `SavedView` | Current/baseline refs and explicit alignment, camera type/pose/target, visibility, section/explode settings, overlay preferences, annotation IDs. UI focus, console size, and live camera are session preferences, not content edits. Save the review pose from the proposal, not the latest live camera. |
| `Measurement` / `Annotation` | Source anchor refs, value in metres, method, scale state, optional error/tolerance if known, displayed units, revision refs, and who created it. Draft evidence belongs to the job until apply; a saved view and its annotations commit together. |
| `Run` / `Proposal` / `Event` | Scope snapshot, typed tool calls and outputs, permission decisions, preview diff, outcome and revert link. Redact sensitive data; persist normalized actions and evidence, not raw mic audio or full model-provider transcripts. |

Record the part graph after applying source node transforms; preserve authored instances and a deterministic local coordinate frame. Product view helpers apply a separate transient transform. Exports carry a schema version and referenced asset hashes so a reviewer can tell exactly which revision was shown.

## 2. Ingest and inspect real models

### Format and source policy

| Input | Plan |
| --- | --- |
| **Local self-contained GLB (pilot)** | Static opaque and standard textured mesh assemblies to start. Require glTF 2.0, actual GLB bytes, embedded buffers/images only, and explicitly supported `extensionsRequired`. Reject unsupported scene features with an export hint (e.g. no rigs, morphs, or animations in the pilot). GLB is a container; don’t assume that any file with `.glb` is self-contained. glTF conventions are right-handed, Y-up, linear units in metres. Always surface whether scale has been confirmed. [1](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| **Downloads (pilot)** | User gets a permitted download and imports it as a file. Offer manual source/author/licence entry and retain known credits on export. Khronos sample assets are useful for rendering fixtures; read the **per-asset** licence. Don’t scrape a model from a viewer or treat a page URL as a binary file. [1](https://github.com/KhronosGroup/glTF-Sample-Assets) |
| **STL, OBJ or multi-file glTF (later, as needed)** | STL/OBJ need a user-selected unit and axis convention before real-world measurements. OBJ/glTF sidecars require explicit bundling and safe local resolution. Ask the user to supply missing textures, or choose an untextured preview where supported. Never resolve arbitrary external resource paths. |
| **STEP / STP (later, for CAD workflows)** | Keep original STEP. A restricted Open CASCADE worker reads assembly, part names, colors and units via XDE, then tessellates to a GLB derivative. Store linear/angular meshing settings and a part/face mapping. Measure in original kernel geometry only once that mapping and unit/tolerance handling pass tests. Don’t sell a tessellated mesh as an editable parametric model or an exact CAD measurement. [1](https://dev.opencascade.org/doc/overview/html/occt_user_guides__step.html) [5](https://dev.opencascade.org/doc/overview/html/occt_user_guides__mesh.html) |
| **One catalog integration (later)** | Choose based on actual use. If Sketchfab is selected, use its documented authenticated Download API, validate/extract its glTF archive in isolation, and persist creator, source link and licence; don’t store expiring signed links or disclose OAuth credentials. A preview licence and permission to redistribute are not the same. [1](https://sketchfab.com/developers/download-api/downloading-models) [2](https://sketchfab.com/developers/terms) |

**Pipeline:** `choose file → quarantine/limit → validate → derive manifest & model → render first frame → index for picking`. Once the model and manifest pass validation, persist them and report render readiness separately. Make long phases cancelable and show actionable failures; no partial import in the tree. Use Khronos glTF Validator plus a stricter product policy; a valid file can still exceed the budget or use unsupported features. [1](https://github.com/KhronosGroup/glTF-Validator/blob/main/node/README.md)

**Initial resource envelope (to profile, not a format limitation):** at most 75 MiB input, 500k rendered triangles including instances and 250 source meshes per revision, 4096 px per texture side, and 128 MiB estimated decoded RGBA base-level texture bytes per active revision. Allow only one import worker by default and cap time/RSS; check expanded geometry/image sizes before allocation where possible, and budget mipmaps, concurrent revisions and caches separately. Start the fixture corpus well below these caps. Reject safely with an export/simplify hint. Add Draco/Meshopt/KTX2 only if sample assets need them and their pinned decoder builds pass the same resource limits; bundle decoders locally. Later preview LODs may simplify drawing, but must not silently replace the measurement mesh. Three.js supports a variety of extensions via its loader and optional decoders. [3](https://threejs.org/docs/pages/GLTFLoader.html)

**Untrusted data:** Enforce size/format and a content-type allowlist, renderer/worker budgets and sandboxing, and withhold unvalidated inputs from the renderer. Use generated storage IDs; treat names, asset extras, and licence text as data, never scripts or model instructions. Reject nested/external URIs for pilot imports. Later for approved catalog archives reject traversal, links, and exceeded expanded size/count; network access stays in a narrow provider downloader with allowlisted destinations and checks on redirects and resolved addresses. The viewer and converters must never become generic fetchers. Keep any downloaded raw bytes outside the web root. These rules layer on top of standard file-upload defenses. [1](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

### 3D that can be trusted

1. **Picking.** Start with a raycast against visible, pickable targets. A viewport click maps to a stable part identity and model-local point. Three.js returns intersections in world coordinates; invert the rendering-only transform for the picked instance, account for section/visibility filters, and compute using source transforms. Rendering and measuring must agree on the pick even when exploded. Add a spatial index only if profiling warrants it. [1](https://threejs.org/docs/pages/Raycaster.html)
2. **Scale and distance.** Keep canonical coordinates in metres, retain original scale/axis provenance, and format to mm/in on display. Fit means moving the camera, not scaling the geometry. Declared GLB scale doesn’t certify a correct exporter. Ask for verification against a known dimension before recording physical measurements. For a confirmed scale, compute Euclidean distance between two source-space points in a common frame. Require anchors on the same revision per measurement. Label cursor picks on tessellation **Approx.**; label authored references **Nominal · authored**. Don’t infer circles, tolerances, or collisions from the shader or the screenshot.
3. **Compare.** Show the selected parts side by side until a shared frame is confirmed (or an explicit rigid alignment is entered). Lock linked camera controls if useful, render current/old with solid/dashed distinction and labelled legend, and compare like-for-like pairs of explicit anchors. No automatic alignment, part matching, or silent rescaling. If no correspondence exists, ask for one; if an old version disappears, show why the comparison can’t be reproduced.
4. **Presentation transforms.** Orthographic/isometric plus front/top/right and perspective presets. Explode is an explicitly labelled display offset by part or authored assembly axis. Section is a clip plane with signed offset and flip control; it’s not boolean geometry, and cut caps aren’t implied. Edges are cached extracted feature edges; optional X-ray reserves dashed/attenuated treatment for occluded structure and keeps labels opaque. Render on invalidation (interaction, loaded asset, changed view, short transition), not on idle; cap DPR and free GPU allocations when swapping heavy revisions. Keep 2D labels out of the shader.

## 3. Orion as a bounded collaborator

**Two lanes, one target model.** Stable commands such as `fit`, `isolate`, `view front` and tool clicks go directly to workbench handlers. Free text goes to Orion with a small allowlisted context. Use the agent for interpreting intent and sequencing, not direct execution. A run can inspect and calculate in the background; zooming or switching selection never changes an already-submitted target. Temporary previews are isolated from durable project state. Only one active durable proposal per project in the pilot; opening another requires discarding or stashing the first explicitly (start with discard, no stash workflow).

**Initial tool catalog**

| Scope | Example tools | Enforcement |
| --- | --- | --- |
| Read / calculate | `scene.describe`, `revision.list`, `measurement.distance` | Scoped IDs from the run snapshot; deterministic, cancellable work returns evidence or typed failure. No raw prompt or arbitrary path as an argument. |
| Preview | `view.preview`, `review.propose` | Validated view edits and a bounded list of domain operations. A proposal lists exactly which named view and annotation would be created. No arbitrary JSON patch or `eval`. |
| Durable or external | `review.apply`, export / download | **User-facing commands only**, not callable by the model. Apply requires positive action on this proposal. Export/download show destination and what will leave or enter; no ambient permission. Raw source edits, shell, publish and delete are out of scope. |

A cloud Orion endpoint, if configured, is a separate data-sharing choice. Show the allowed fields/destination at setup, require explicit opt-in, and expose the scope before each request. Send the prompt plus minimal approved identifiers, structured results, labels or dimensions; don’t send raw CAD, screenshots, keys or ambient files. Treat any retrieved text as untrusted. If an approved provider is unavailable, show **Orion disconnected · manual controls available**. Future push-to-talk uses a permission-gated recorder in a secure context and a separately selected speech adapter; display recording/transcribing state, drop audio after transcription by default and reset on cancel. Don’t rely on native browser speech recognition for cross-browser availability or offline behavior. [1](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts) [2](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous)

### A minimal wire contract

Illustrative v1 payload. A project version is different from an imported file revision. The server resolves and verifies every ref and binds a proposal to the exact version and permissions that generated it.

```json
{
  "schema": 1,
  "projectId": "bench-enclosure",
  "baseProjectVersion": 11,
  "selection": {"assetId": "enclosure", "revisionId": "r07", "partId": "mount-plate"},
  "baseline": {"assetId": "enclosure", "revisionId": "r06", "partId": "mount-plate"},
  "intent": "Compare these two revisions. Flag the hole spacing and save a review view."
}
```

- `POST /api/v1/projects/{id}/imports` queues a streamed file. `POST …/runs` accepts a scoped request and returns a run ID immediately. `GET /api/v1/runs/{id}` returns a compact snapshot; `GET …/events` uses server-sent events with monotonic IDs for reconnect. Events include `run.started`, `step.running`, `measurement.ready`, `run.needs_input`, `review.ready`, and final outcomes; store/replay durable events, not every token. Handle reconnect by resume or snapshot, never by starting a second run.
- A `measurement.ready` event attaches the method and anchor references, plus SI values `r06: 0.042`, `r07: 0.044`, `delta: 0.002`, for the nominal fixture. The console summary and inspector callout reference that record. Render numbers from the validated record even if free-text prose is wrong or missing. A `review.ready` event carries a `proposalId`, scope, base version, a captured view, evidence IDs and domain operations such as `savedView.create` and `annotation.create`.
- A run can go from `running` to `needs_input` or `awaiting_review`. `POST /api/v1/runs/{id}/inputs` supplies a validated choice or anchor for a particular outstanding input request. Resume with the same scope; don’t silently guess or rebind to the latest selection. Use a small tool/step budget and timeout; ask for a choice or fail cleanly if a step can’t resolve. `POST /api/v1/runs/{id}/cancel` propagates cancellation to the adapter and workers, and late results from a cancelled run are ignored. Terminal outcomes are `completed` (no durable project change), `applied`, `discarded`, `cancelled`, or `failed`.
- `POST /api/v1/proposals/{id}/apply` takes an idempotency key and expected version. In one transaction verify that the proposal is pending, the base version is current, all referenced IDs and the proposal digest match, and the session still has permission; apply the allowlisted operations and append an audit record. An addressed discard removes the preview and records its outcome; serialize it against apply so only one wins. Keep stale proposals inspectable but disable **Save review** until regenerated; don’t auto-merge. Replayed requests return the original outcome without duplicate annotations. Undo writes a compensating revision. Verify same-origin host/session and mutation protections; no public LAN write endpoint or permissive CORS.

## 4. Add one spatial output only after proving the workflow

Define `PresentationScene` as a read-only projection of a saved or live view, with render assets, model units, source-to-presentation transforms, active revision, visibility and selected annotation anchors. A display adapter can render that packet but cannot commit project changes. Use explicit **Present on…**, do not mirror the console or approvals, and preserve the monitor state if output disconnects.

- **If a headset is the actual use case:** prototype the same scene on one supported headset/browser via feature-detected `immersive-ar` in a secure context. Use a place/recenter workflow; report scale, and keep true-size vs. tabletop miniature explicit. Treat hit-test, anchors, depth occlusion, and hand input as separately verified capabilities. Use controller input first; if hands help, use a pinch to acquire/release, bounded smoothing, and cancel on tracking loss so loss can’t be interpreted as a completed drag. [1](https://www.w3.org/TR/webxr/) [5](https://www.w3.org/TR/webxr-depth-sensing-1/)
- **If a shared desk display is the actual use case:** test one Looking Glass-class display with its Bridge. Use calibrated views of the same scene, conservative depth range, and sparse short labels or none. Benchmark real GPU time as the view count increases. Verify device/OS/Bridge support and latency before committing. [2](https://docs.lookingglassfactory.com/software/looking-glass-bridge-sdk/integrating-native-applications) [1](https://docs.lookingglassfactory.com/software/creator-tools/webxr)
- **Gate:** test the same occlusion/order or part-placement task with five users in counterbalanced monitor/spatial trials. Measure time, wrong picks, setup effort, and discomfort. Continue only if there’s a useful improvement (provisional target: ≥20% faster **or** materially fewer errors without worse comfort) and the extra setup pays for itself in ordinary sessions. Otherwise keep it an optional presentation demo. No hardware purchase is a prerequisite for the core app.

## 5. Test and ship in thin slices

| Cut | Deliverable / critical tests |
| --- | --- |
| **0 · Define** | Versioned fixtures: two authored enclosure revisions, known common origin and `42.0 → 44.0 mm`; an out-of-scale model, duplicate node names, repeated/rotated instances, invalid/truncated GLB, and one asset near the import cap. Confirm actual CAD/export workflow and Orion interfaces. Time the current comparison-and-save loop. |
| **1 · Inspect** | Real file → tree/viewport → geometry points → saved view → restart/reopen. Test axes, units, orientation, source immutability, keyboard-only access, validation rejection, context loss, and import cancel. For the authored fixture, expected 42/44 mm values must match to `±0.01 mm` numerically; this is an assertion about fixture math, not physical precision. |
| **2 · Review** | Fixture-first adapter, then real runtime. Compare two revisions with aligned pose; measure, produce a tied evidence link, preview, save and undo; prove disconnect and retry handling. Reject unknown commands, mismatched scopes, missing anchors, stale/double apply; ignore late results after cancel. Check overlay geometry against both source revisions and prove presentation explosion doesn’t alter dimensions. Export a reproducible review record with attribution. |
| **3 · Expand** | Reuse the same tests per new format, input or output. For STEP, benchmark the actual assemblies and measure against trusted CAD reference values; for voice, test real rooms/accents, misheard targets and cancel; for hardware, use the gate above. |

**Speed-of-mind targets, not claims:** On the chosen daily machine, use a licensed/static 25 MiB-or-less fixture at 1920×1080, 60 Hz (log OS, browser, GPU, power mode and exact fixture). Aim for **p95 ≤100 ms** to visible feedback for selection and command submission; **p95 ≤2 s** to the first interactive frame for a cold local import of that fixture; **p95 ≤20 ms** presented-frame interval during an active 10-second orbit on a representative static assembly (test with and without an agent run). Record layout/long tasks and input delay with browser performance marks/traces; record agent completion time separately. If it’s slow, profile import decoding and draw calls before switching renderer or reducing geometry quality.

**Test layers:** Unit-test transforms, distance, import policy, and proposal transitions; integration-test durable storage and event replay with the deterministic adapter; exercise import, focus, pending review, undo and restart in Playwright. Take a screenshot of the actual fixture review for comparison with the static design target. Measure GPU performance separately on real hardware.

**Practical usability gate:** Run five users through paired trials on their normal tooling versus Orion for import → locate part → compare → save/reopen. Counterbalance order, keep geometry and requested outputs fixed, track time to a **correct saved result**, target selection errors, and corrections. Start with a directional goal of ≥25% lower median time with no rise in wrong-target commits; small-pilot results are evidence to iterate, not a generalized performance claim. Run a keyboard-only pass and a longer session with reduced motion, 200% text zoom, and model provider disconnected. Include a locale with decimal-comma display while preserving SI numbers internally.

**Required inputs at kickoff:** the owner’s OS/browser, two real exported model revisions (or the proposed fixture first), and the interface Orion currently exposes for request, streamed progress, and cancel. Hardware preference and speech provider can wait. If the runtime isn’t callable yet, ship the manual viewer milestone independently and keep the test adapter visibly in demo mode.
