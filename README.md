# Letterfold

A TypeScript library for simple, sequential 3D letter folds, with an optional Three.js viewer and an interactive demo.

```sh
npm install
npm run dev         # interactive demo
npm test
npm run build       # demo + ESM library + TypeScript declarations
```

## Library

The library build is in `dist/lib`. The root entry point has no DOM or WebGL dependency. The Three.js renderer is a separate import.

```ts
import { createPaper } from "letterfold";
import { ThreePaperRenderer } from "letterfold/three";

const paper = createPaper({
  width: 0.21,
  height: 0.297,
  thickness: 0.00012, // 0.12 mm; all dimensions are in metres
  pattern: "letter", // 'letter' | 'half' | 'accordion'
});

paper.setProgress(0.75); // direct, deterministic geometry evaluation
const viewer = new ThreePaperRenderer(
  document.querySelector("#viewer")!,
  paper,
);
viewer.update();

paper.setProgress(1); // fully closed, 180° folds
viewer.update();

paper.setThickness(0.0002); // keep progress, update crease geometry
paper.reset("accordion"); // change pattern and return to the flat sheet
viewer.update();
viewer.dispose();
```

Call `setProgress()` and `viewer.update()` from your own animation loop. Progress is clamped to `[0, 1]`; `seek()` is an alias. Scrubbing and reversing produce exactly the same geometry regardless of history. No settling frames are required. The demo is an example consumer, not the library API.

The mesh exposes original material coordinates (`rest`), current mid-surface coordinates (`positions`), surface `normals`, triangle `indices`, and `creaseRows`. Re-read buffer references when `revision` changes: thickness changes and `reset()` rebuild the mesh. The bundled renderer handles this automatically. Dispose the viewer when unmounting it.

## How layers work

The original elastic prototype drove both flaps into the same volume. The default model now represents paper thickness and fold order explicitly:

1. The bottom flap closes onto the centre panel.
2. The upper flap bends around the two-layer stack and rests above the first flap.
3. All flaps close to 180°, with a rounded crease instead of coincident, zero-thickness planes.

The crease is a circular bend joined tangentially to a rigid flap. It consumes material length equal to `radius × angle`, preserving the continuous sheet's arc length. The first crease radius is half the layer spacing; the outer letter crease radius is one full layer spacing. The artwork remains attached to original material coordinates. There are 32 extra mesh rows per crease to resolve the narrow curved region.

Mid-surfaces are separated by 1.15 times the paper thickness. The small clearance accommodates tessellation and prevents depth flicker. The viewer renders front and back surfaces offset by half the actual thickness, plus side faces along the exposed boundary. It does not hide intersections using draw order or depth offsets.

This is a **constrained geometric folding model** for the supported presets, not a force-based simulation or general-purpose collision solver. It does not simulate gravity, wrinkles, friction, arbitrary intersecting creases, or multiple independent sheets. The preserved experimental `PaperSimulation` is available from `letterfold/experimental`; it has no layer contact and is not used by the demo.

## Validation

Tests check distances between nonadjacent mesh strips at 161 points throughout each fold, for all three patterns and thicknesses of 0.06, 0.12, and 0.80 mm. Since these folds are uniform across the width, their 2D cross-sections represent the entire surface strips. Tests also cover final layer order, deterministic seeking/reversal, changing thickness, reset, and input validation. The experimental solver retains its original tests.

The presets use thirds or repeated halves of a rectangular sheet. Custom crease sequences, SVG fold-metadata interpretation, and FOLD import/export remain future library work. SVG artwork import is supported by the renderer. The demo's letter texture is generated locally; Google Fonts have local font fallbacks.

## Folds across both directions

Three additional presets fold the entire accumulated packet, alternating across its width and height:

| Pattern        | Sequence                                 | Final layers |
| -------------- | ---------------------------------------- | ------------ |
| `cross`        | right → left, top → bottom               | 4            |
| `double-cross` | width, height, width, height             | 16           |
| `fivefold`     | width, height, then width, height, width | 32           |

```ts
const packet = createPaper({ pattern: "fivefold", thickness: 0.00012 });
packet.setProgress(0.4); // first two folds closed
packet.setProgress(1); // three further folds closed
```

Each step uses the packet's current coordinates and stack height, including previously bent layers. Crease sampling is mapped back to original material coordinates so the mesh resolves folds in both directions. Normals follow the bend's inverse-transpose transform. These compound bends are a geometric stack approximation: they allow compression/sliding in the curved bands and are not an inextensible rigid-origami or force/contact solution at intersecting creases.

The maximum thickness is 0.40 mm for `double-cross` and 0.20 mm for `fivefold`, and may be lower for small custom sheets. `maxThickness` exposes the limit; constructor/setter inputs above it throw. Changing patterns with `reset()` reduces the existing thickness to the new limit, preserving the ability to switch examples in the demo. The demo displays the resulting thickness. Use **Fit paper in view** to inspect the compact packet, or orbit and zoom normally.

Compound-preset tests check finite positions, normalized normals throughout motion, packet dimensions, accumulated layer height, deterministic reversal and thickness limits. The earlier strip-distance collision tests apply to the original parallel presets, not the compound bends.

## Slightly imperfect folds

Use `imperfection` to give each crease an independent, small tilt in its own folding plane. The setting is the **maximum angle in degrees**, from 0 (the default, precise model) to 2.0. A seed controls the random angles, so scrubbing, reversing, resetting, or reconstructing the same configuration does not change them.

```ts
const paper = createPaper({
  pattern: "letter",
  imperfection: 0.25, // each crease is tilted by at most ±0.25°
  seed: 123,
});
paper.setImperfection(0.35); // change strength, retain seed and progress
paper.setImperfection(0.35, 456); // new reproducible variation
console.log(paper.foldAngles); // actual signed crease tilts in degrees
paper.setImperfection(0); // restore the original precise geometry
```

Seeds must be integers from 0 through 4294967295. The demo's **New variation** button chooses a fresh seed; it does not introduce per-frame noise. Imperfection and seed survive pattern changes. All six presets support tilted folds.

Imperfect folds use local rotated crease frames and a mesh split along the actual tilted crease and 32 subdivisions of each bend. Adjacent triangles share the new vertices, so the curved strip stays connected. Each step transforms the whole accumulated packet, including any previously folded edge that protrudes across the new crease. Crease guides are intersections with those actual tilted planes. The letter's outer crease leaves extra stack clearance to accommodate these protrusions. The renderer builds exposed side faces from mesh connectivity rather than rectangular row assumptions. Use `indices` as the authoritative topology: imperfect-mode meshes are not rectangular grids. Arbitrary-angle self-contact is still not guaranteed by a general collision solver. At zero imperfection the original geometry and existing separation tests are unchanged.

Additional tests cover seeded reproduction, independent bounded crease angles, the actual tilted crease line, seeking/reset, restoration of precise mode, validation, and finite geometry with normalized normals for all six presets.

## Black borders and crease guides

The optional Three.js renderer can draw black icon-style borders around the paper perimeter and the visible silhouettes of folded creases. Strokes use screen-space width, so their size stays consistent while zooming.

```ts
const viewer = new ThreePaperRenderer(element, paper, {
  borders: true,
  borderWidth: 3, // CSS pixels (0.5–8)
  borderColor: "#000",
});
viewer.setBorders(true);
viewer.setBorderWidth(2);
viewer.setBorderColor("#000000");
viewer.setArtwork(false); // useful for a clean icon appearance
viewer.setCreases(false); // omit instructional guides in the icon
```

In the demo, **Border width** is always visible (0.5–8 CSS pixels); adjusting it also enables **Black borders**. Borders use depth testing so hidden edges remain hidden. When **Crease guides** is enabled, guides are solid antialiased markings on both faces of the paper, with depth testing enabled and depth writing disabled. A tiny offset along the surface normal prevents coplanar flicker; nearer paper layers hide covered guides. The guide toggle still hides them completely when desired.

Crease-mesh regression tests check positive triangle area, total material area, shared interior edges, absence of internal boundary edges, and gradual normal changes across a tilted half-fold bend.

## SVG artwork

Use **Import SVG** in the demo to select a local file, or **Try SVG design** for the supplied design. The image retains its proportions and is centred on the sheet, with paper-coloured margins when the aspect ratios differ. **Restore sample letter** restores the original artwork. Imports are processed locally and are not sent to a server.

```ts
const svg = await file.text(); // a File from your file picker, or any SVG string
await viewer.setSvgArtwork(svg); // front (default)
await viewer.setSvgArtwork(backSvg, "back"); // independent reverse design
viewer.setArtwork(true);
viewer.update();
// Later:
viewer.resetArtwork(); // restore the sample front letter
viewer.resetArtwork("back"); // clear only the reverse design
```

The renderer rasterizes the SVG into an sRGB canvas texture (up to 2048 pixels wide and 4096 high), with anisotropic filtering. Original material UVs keep artwork attached during folding, including imperfect folds. Front and back artwork are independent. Back UVs are horizontally reversed so text reads correctly when viewed from behind. The artwork toggle affects both faces. The SVG remains your design source, while the displayed texture is raster rather than infinitely scalable vector geometry.

Use self-contained SVGs up to 2 MB. Embed raster images and outline text if you need exact typography independent of local fonts; external image references are rejected. Invalid SVGs leave the current artwork intact. Script/embedded HTML elements and a metadata group named `folds` are removed before rasterization. This method does not parse crease instructions: fold geometry still comes from the selected library pattern. Later artwork requests take precedence over earlier decodes, and disposing or resetting the renderer cancels pending replacements.

## Soft lighting and shadows

The renderer uses bright ambient fill and a directional key light with blurred variance shadow maps. Paper casts shadows onto other folds, while fill keeps shaded faces readable. Shadow maps update when the paper changes, rather than on every camera frame.

Set `lightingContrast` (default `0.45`) and `shadowSoftness` (default `0.7`) in `PaperRendererOptions`, or call `setLightingContrast(value)` and `setShadowSoftness(value)` at runtime. Both accept 0–1. Zero contrast gives flat fill; higher contrast gives stronger depth cues. The demo exposes both as percentage sliders. Shadow maps are a visual approximation; very tightly stacked layers may have less distinct shadows.

## Camera views for each fold

The demo's **Camera per fold** editor stores an opening view and an endpoint for each fold, separately for each pattern during the current session. Choose a step to preview it, then set the angles and distance. Or disable **Follow saved views**, orbit/zoom, and use **Save current view here**. Enable following to play or scrub the saved sequence. Perspective, top, and fit buttons return to free camera mode.

Views use the original paper frame (X across the sheet, Y up the sheet, Z out of its front), centered on the current folded packet. They do not attach to an individual moving flap. Distance is measured in multiples of the original sheet diagonal, so folding does not cause automatic zoom jumps. Angles are degrees; azimuth zero looks from the bottom edge, elevation is -89–89°, and roll rotates the view clockwise.

```ts
viewer.setCameraSequence([
  { azimuth: 35, elevation: 50, distance: 1.7, roll: 0 }, // open sheet
  { azimuth: -30, elevation: 65, distance: 1.3, roll: 0 }, // fold 1 finished
  { azimuth: 0, elevation: 89, distance: 1, roll: 15 }, // fold 2 finished
]);
// In your animation loop, using the same progress as the paper:
viewer.setCameraProgress(paper.progress);
viewer.update();
// Return to manual orbiting, or capture a pose:
viewer.setCameraFollowing(false);
const pose = viewer.captureCameraView();
```

`PaperCameraView` and `sampleCameraSequence` are exported from `letterfold/three`. Sequences interpolate smoothly between evenly spaced fold endpoints, using the shortest angular path. Seeking and reversing reproduce the same camera pose. Setting an empty sequence disables following. Distances supported by the sequence API are 0.2–10 sheet diagonals.

Use **Import front SVG** and **Import back SVG** in the demo. Each accepts a separate SVG up to 2 MB and has its own reset control. Concurrent loading and resets are tracked independently for each side.
