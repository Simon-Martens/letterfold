import { visibleBorderSegments } from "./border-visibility";
import { sealGeometry, type PaperSealOptions } from "./seal";
import {
  exportSchematicSvg,
  type SchematicSvgOptions,
  type SvgStroke,
} from "./svg-export";
import {
  sampleCameraSequence,
  validateCameraView,
  type PaperCameraView,
} from "./camera";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { rasterizeSvg } from "./svg-artwork";
import type { PaperMesh } from "./paper";

function letterTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = 1414;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff9e9";
  ctx.fillRect(0, 0, 1000, 1414);
  // Deterministic fibre grain, kept subtle enough to preserve legibility.
  let seed = 71;
  for (let i = 0; i < 26000; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = seed % 1000;
    seed = (seed * 16807) % 2147483647;
    const y = seed % 1414;
    ctx.fillStyle = `rgba(112,88,54,${0.015 + (i % 4) * 0.007})`;
    ctx.fillRect(x, y, 1, 2);
  }
  ctx.fillStyle = "#718575";
  ctx.font = "18px Georgia";
  ctx.textAlign = "center";
  ctx.fillText("C O R R E S P O N D E N C E", 500, 130);
  ctx.strokeStyle = "#b7b29e";
  ctx.beginPath();
  ctx.moveTo(420, 160);
  ctx.lineTo(580, 160);
  ctx.stroke();
  ctx.textAlign = "right";
  ctx.fillStyle = "#6e746a";
  ctx.font = "italic 25px Georgia";
  ctx.fillText("October 9, 1897", 855, 245);
  ctx.textAlign = "left";
  ctx.fillStyle = "#45564b";
  ctx.font = "italic 34px Georgia";
  ctx.fillText("My dear friend,", 125, 345);
  const lines = [
    "There is something quite wonderful",
    "about a letter. A thought, made tangible;",
    "a little piece of one place, carried",
    "across the distance to another.",
    "",
    "I have kept this sheet by the window,",
    "where the afternoon light falls softly.",
    "Now I fold it, once and then again,",
    "and send a little of that light to you.",
    "",
    "Until we meet again,",
  ];
  ctx.font = "italic 29px Georgia";
  lines.forEach((line, i) => ctx.fillText(line, 125, 425 + i * 52));
  ctx.font = "italic 40px Georgia";
  ctx.fillText("Yours, always", 490, 1065);
  ctx.font = "16px Georgia";
  ctx.fillStyle = "#a09d8b";
  ctx.textAlign = "center";
  ctx.fillText("A THOUGHT, FOLDED INTO SOMETHING YOU CAN HOLD.", 500, 1305);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export type PaperSide = "front" | "back";

export interface PaperRendererOptions {
  seal?: boolean | PaperSealOptions;
  borders?: boolean;
  /** Screen-space stroke width in CSS pixels, from 0.5 to 8. */
  borderWidth?: number;
  borderColor?: THREE.ColorRepresentation;
  /** 0 = flat fill, 1 = stronger directional shading. */
  lightingContrast?: number;
  /** Shadow blur, from 0 (crisp) to 1 (soft). */
  shadowSoftness?: number;
}

export class ThreePaperRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.01, 3);
  readonly controls: OrbitControls;
  readonly geometry = new THREE.BufferGeometry();
  private position: THREE.BufferAttribute;
  private backGeometry = new THREE.BufferGeometry();
  private edgeGeometry = new THREE.BufferGeometry();
  private edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7c9ac,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  private sealOptions: PaperSealOptions | null = null;
  private seal = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0x992c26,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
  );
  private sealStamp = -1;
  private meshRevision = -1;
  private stateVersion = -1;
  private front: THREE.MeshStandardMaterial;
  private back: THREE.MeshStandardMaterial;
  private texture = letterTexture();
  private backTexture: THREE.Texture | null = null;
  private artworkRequest = { front: 0, back: 0 };
  private disposed = false;
  private artworkVisible = true;
  private wire: THREE.Mesh;
  private creases: LineSegments2;
  private creaseGeometry = new LineSegmentsGeometry();
  private borderGeometry = new LineSegmentsGeometry();
  private borderMaterial = new LineMaterial({
    color: 0x000000,
    linewidth: 2,
    worldUnits: false,
    depthTest: true,
    depthWrite: false,
    alphaToCoverage: true,
    toneMapped: false,
  });
  private borders = new LineSegments2(this.borderGeometry, this.borderMaterial);
  private outlineEdges: { a: number; b: number; faces: number[] }[] = [];
  private borderStamp = "";
  private faceSigns = new Int8Array(0);
  private ambient = new THREE.AmbientLight(0xfffcf5, 2.6);
  private keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  private cameraSequence: PaperCameraView[] = [];
  private cameraProgress = 0;
  private followCamera = false;
  private resizeObserver: ResizeObserver;
  constructor(
    readonly element: HTMLElement,
    readonly simulation: PaperMesh,
    options: PaperRendererOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xf0eee7, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    element.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D paper. Drag to orbit, scroll to zoom.",
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.04;
    this.controls.maxDistance = 1.2;
    this.controls.enablePan = false;
    this.camera.up.set(0, 1, 0);
    this.home();
    // A bright fill limits contrast; only the broad key casts shadows.
    this.scene.add(this.ambient);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xf1ede4, 0.9));
    const light = this.keyLight;
    const span = Math.hypot(simulation.width, simulation.height);
    light.position.set(-span, span * 1.4, span * 2.2);
    light.castShadow = true;
    Object.assign(light.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: span * 0.1,
      far: span * 5,
    });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.00002;
    light.shadow.normalBias = span * 0.00004;
    light.shadow.blurSamples = 12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.setLightingContrast(options.lightingContrast ?? 0.45);
    this.setShadowSoftness(options.shadowSoftness ?? 0.7);
    this.scene.add(light, light.target);
    const fill = new THREE.DirectionalLight(0xf5faf7, 0.35);
    fill.position.set(0.4, -0.2, 0.3);
    this.scene.add(fill);
    this.position = new THREE.BufferAttribute(
      new Float32Array(simulation.positions),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.position);
    this.geometry.setIndex(simulation.indices);
    const uv = new Float32Array(simulation.count * 2);
    for (let i = 0; i < simulation.count; i++) {
      uv[i * 2] = simulation.rest[i * 3] / simulation.width + 0.5;
      uv[i * 2 + 1] = simulation.rest[i * 3 + 1] / simulation.height + 0.5;
    }
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    this.geometry.computeVertexNormals();
    this.front = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.96,
      side: THREE.FrontSide,
    });
    this.back = new THREE.MeshStandardMaterial({
      color: 0xf6efdf,
      roughness: 1,
      side: THREE.BackSide,
    });
    for (const mesh of [
      new THREE.Mesh(this.geometry, this.front),
      new THREE.Mesh(this.backGeometry, this.back),
      new THREE.Mesh(this.edgeGeometry, this.edgeMaterial),
    ]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material.shadowSide = THREE.DoubleSide;
      this.scene.add(mesh);
    }
    this.wire = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        color: 0x4b7968,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
        depthTest: false,
      }),
    );
    this.wire.visible = false;
    this.scene.add(this.wire);
    this.creases = new LineSegments2(
      this.creaseGeometry,
      new LineMaterial({
        color: 0xa76c43,
        linewidth: 1.6,
        worldUnits: false,
        depthTest: true,
        depthWrite: false,
        alphaToCoverage: true,
        toneMapped: false,
      }),
    );
    // Guides are surface markings: nearer paper must occlude them.
    this.creases.renderOrder = 30;
    this.wire.renderOrder = 10;
    (this.wire.material as THREE.Material).depthWrite = false;
    this.borders.renderOrder = 20;
    this.borders.visible = options.borders ?? false;
    this.setBorderWidth(options.borderWidth ?? 2);
    this.borderMaterial.color.set(options.borderColor ?? 0x000000);
    this.scene.add(this.creases, this.borders, this.seal);
    this.setSeal(options.seal ?? false);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(element);
    this.resize();
    this.update();
  }
  /** One opening view followed by one endpoint per fold. Empty disables the sequence. */
  setCameraSequence(views: readonly PaperCameraView[]) {
    views.forEach(validateCameraView);
    this.cameraSequence = views.map((view) => ({ ...view }));
    this.setCameraFollowing(views.length > 0);
  }
  setCameraFollowing(enabled: boolean) {
    this.followCamera = enabled && this.cameraSequence.length > 0;
    this.controls.enabled = !this.followCamera;
  }
  setCameraProgress(progress: number) {
    if (!Number.isFinite(progress))
      throw new Error("Camera progress must be finite.");
    this.cameraProgress = Math.max(0, Math.min(1, progress));
  }
  captureCameraView(): PaperCameraView {
    const delta = this.camera.position.clone().sub(this.controls.target);
    const distance = delta.length();
    const azimuth = Math.atan2(delta.x, -delta.y);
    const elevation = Math.asin(delta.z / distance);
    const referenceUp = new THREE.Vector3(
      -Math.sin(azimuth) * Math.sin(elevation),
      Math.cos(azimuth) * Math.sin(elevation),
      Math.cos(elevation),
    );
    const reference = new THREE.Matrix4().lookAt(
      this.camera.position,
      this.controls.target,
      referenceUp,
    );
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      this.camera.quaternion,
    );
    const right = new THREE.Vector3().setFromMatrixColumn(reference, 0);
    const baseUp = new THREE.Vector3().setFromMatrixColumn(reference, 1);
    return {
      azimuth: THREE.MathUtils.radToDeg(Math.atan2(delta.x, -delta.y)),
      elevation: THREE.MathUtils.clamp(
        THREE.MathUtils.radToDeg(Math.asin(delta.z / distance)),
        -89,
        89,
      ),
      distance: THREE.MathUtils.clamp(
        distance / Math.hypot(this.simulation.width, this.simulation.height),
        0.2,
        10,
      ),
      roll: THREE.MathUtils.radToDeg(Math.atan2(up.dot(right), up.dot(baseUp))),
    };
  }
  private updateCameraSequence() {
    if (!this.followCamera) return;
    const view = sampleCameraSequence(this.cameraSequence, this.cameraProgress);
    const azimuth = THREE.MathUtils.degToRad(view.azimuth);
    const elevation = THREE.MathUtils.degToRad(view.elevation);
    const roll = THREE.MathUtils.degToRad(view.roll);
    const distance =
      view.distance * Math.hypot(this.simulation.width, this.simulation.height);
    this.camera.far = Math.max(
      3,
      distance + Math.hypot(this.simulation.width, this.simulation.height) * 2,
    );
    this.camera.updateProjectionMatrix();
    this.camera.position
      .set(
        Math.sin(azimuth) * Math.cos(elevation),
        -Math.cos(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
      )
      .multiplyScalar(distance)
      .add(this.controls.target);
    this.camera.up.set(
      -Math.sin(azimuth) * Math.sin(elevation),
      Math.cos(azimuth) * Math.sin(elevation),
      Math.cos(elevation),
    );
    this.camera.lookAt(this.controls.target);
    this.camera.rotateZ(-roll);
    this.camera.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
  }
  home(top = false) {
    this.setCameraFollowing(false);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(top ? 0 : 0.24, top ? 0 : -0.3, top ? 0.58 : 0.48);
    this.controls.target.set(0, 0, 0.015);
    this.controls.update();
  }
  fit() {
    this.geometry.computeBoundingSphere();
    const sphere = this.geometry.boundingSphere;
    if (!sphere) return;
    const offset = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position
      .copy(sphere.center)
      .addScaledVector(offset, Math.max(0.04, sphere.radius * 3.6));
    this.controls.update();
  }
  private resize() {
    const w = this.element.clientWidth,
      h = this.element.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
  setBorders(value: boolean) {
    this.borders.visible = value;
    this.borderStamp = "";
  }
  setBorderWidth(pixels: number) {
    if (!Number.isFinite(pixels) || pixels < 0.5 || pixels > 8)
      throw new Error("Border width must be between 0.5 and 8 CSS pixels.");
    this.borderMaterial.linewidth = pixels;
  }
  setLightingContrast(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Lighting contrast must be between 0 and 1.");
    this.ambient.intensity = 3.1 - value * 1.4;
    this.keyLight.intensity = value * 2;
  }
  setShadowSoftness(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Shadow softness must be between 0 and 1.");
    this.keyLight.shadow.radius = 1 + value * 7;
    this.renderer.shadowMap.needsUpdate = true;
  }
  setBorderColor(color: THREE.ColorRepresentation) {
    this.borderMaterial.color.set(color);
  }
  setWireframe(value: boolean) {
    this.wire.visible = value;
  }
  setArtwork(value: boolean) {
    this.artworkVisible = value;
    this.front.map = value ? this.texture : null;
    this.front.needsUpdate = true;
    this.back.map = value ? this.backTexture : null;
    this.back.color.set(this.back.map ? 0xffffff : 0xf6efdf);
    this.back.needsUpdate = true;
  }
  /** Load front or back SVG artwork; original material UVs carry it through folds. */
  async setSvgArtwork(svg: string, side: PaperSide = "front"): Promise<void> {
    if (this.disposed) throw new Error("The renderer has been disposed.");
    const request = ++this.artworkRequest[side];
    const canvas = await rasterizeSvg(
      svg,
      this.simulation.width / this.simulation.height,
    );
    if (this.disposed || request !== this.artworkRequest[side]) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    if (side === "front") {
      this.texture.dispose();
      this.texture = texture;
    } else {
      this.backTexture?.dispose();
      this.backTexture = texture;
    }
    this.setArtwork(this.artworkVisible);
  }
  resetArtwork(side: PaperSide = "front") {
    if (this.disposed) return;
    this.artworkRequest[side]++;
    if (side === "front") {
      this.texture.dispose();
      this.texture = letterTexture();
    } else {
      this.backTexture?.dispose();
      this.backTexture = null;
    }
    this.setArtwork(this.artworkVisible);
  }
  /** Export this camera view as standalone schematic paths (no textures or shadows). */
  exportSvg(options: SchematicSvgOptions = {}): string {
    this.update();
    const width = options.width ?? 1000;
    const height =
      options.height ??
      Math.max(64, Math.min(2048, Math.round(width / this.camera.aspect)));
    const strokes: SvgStroke[] = [];
    for (const [line, guide] of [
      [this.borders, false],
      [this.creases, true],
    ] as const) {
      if (!line.visible) continue;
      const starts = line.geometry.getAttribute("instanceStart"),
        ends = line.geometry.getAttribute("instanceEnd");
      if (!starts || !ends) continue;
      const positions: number[] = [];
      for (let i = 0; i < starts.count; i++)
        positions.push(
          starts.getX(i),
          starts.getY(i),
          starts.getZ(i),
          ends.getX(i),
          ends.getY(i),
          ends.getZ(i),
        );
      strokes.push({
        positions,
        width: (line.material.linewidth * width) / this.element.clientWidth,
        guide,
      });
    }
    const camera = this.camera.clone();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return exportSchematicSvg(
      [
        { geometry: this.geometry, side: "front" },
        { geometry: this.backGeometry, side: "back" },
        { geometry: this.edgeGeometry, side: "both" },
        ...(this.seal.visible
          ? [
              {
                geometry: this.seal.geometry,
                side: "both" as const,
                color: "#992c26",
              },
            ]
          : []),
      ],
      strokes,
      camera,
      { ...options, width, height },
    );
  }
  /** Add decorative wax across the closing seam. Hidden until fully folded. */
  setSeal(options: boolean | PaperSealOptions) {
    const next =
      options === false ? null : options === true ? {} : { ...options };
    if (next) {
      const check = sealGeometry(this.simulation, next);
      check.dispose();
    }
    this.sealOptions = next;
    this.sealStamp = -1;
    this.borderStamp = "";
    this.seal.visible = false;
  }
  private updateSeal() {
    this.seal.visible =
      this.sealOptions !== null && (this.simulation.progress ?? 0) >= 1;
    if (
      !this.seal.visible ||
      (this.simulation.stateVersion !== undefined &&
        this.sealStamp === this.simulation.stateVersion)
    )
      return;
    this.seal.geometry.dispose();
    this.seal.geometry = sealGeometry(this.simulation, this.sealOptions!);
    this.sealStamp = this.simulation.stateVersion ?? -1;
  }
  setCreases(value: boolean) {
    this.creases.visible = value;
  }
  update() {
    if (
      this.simulation.stateVersion === undefined ||
      this.stateVersion !== this.simulation.stateVersion
    ) {
      this.renderer.shadowMap.needsUpdate = true;
      this.stateVersion = this.simulation.stateVersion ?? -1;
      const paper = this.simulation;
      if (this.meshRevision !== (paper.revision ?? 0)) {
        this.meshRevision = paper.revision ?? 0;
        this.position = new THREE.BufferAttribute(
          new Float32Array(paper.positions.length),
          3,
        ).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute("position", this.position);
        this.backGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(
            new Float32Array(paper.positions.length),
            3,
          ).setUsage(THREE.DynamicDrawUsage),
        );
        const edgeMap = new Map<
          string,
          { a: number; b: number; faces: number[] }
        >();
        for (let face = 0; face < paper.indices.length / 3; face++)
          for (let k = 0; k < 3; k++) {
            const a = paper.indices[face * 3 + k],
              b = paper.indices[face * 3 + ((k + 1) % 3)],
              key = `${Math.min(a, b)}:${Math.max(a, b)}`;
            const edge = edgeMap.get(key);
            if (edge) edge.faces.push(face);
            else edgeMap.set(key, { a, b, faces: [face] });
          }
        this.outlineEdges = [...edgeMap.values()];
        this.faceSigns = new Int8Array(paper.indices.length / 3);
        this.borderStamp = "";
        this.geometry.setIndex(paper.indices);
        this.backGeometry.setIndex(paper.indices);
        const uv = new Float32Array(paper.count * 2);
        for (let i = 0; i < paper.count; i++) {
          uv[i * 2] = paper.rest[i * 3] / paper.width + 0.5;
          uv[i * 2 + 1] = paper.rest[i * 3 + 1] / paper.height + 0.5;
        }
        this.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        // Reverse horizontally so the back reads correctly when viewed from behind.
        const backUv = uv.slice();
        for (let i = 0; i < paper.count; i++) backUv[i * 2] = 1 - backUv[i * 2];
        this.backGeometry.setAttribute(
          "uv",
          new THREE.BufferAttribute(backUv, 2),
        );
      }
      const backPosition = this.backGeometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let i = 0; i < paper.positions.length; i++) {
        const offset = ((paper.normals?.[i] ?? 0) * (paper.thickness ?? 0)) / 2;
        this.position.array[i] = paper.positions[i] + offset;
        backPosition.array[i] = paper.positions[i] - offset;
      }
      this.position.needsUpdate = true;
      backPosition.needsUpdate = true;
      for (const geometry of [this.geometry, this.backGeometry]) {
        if (paper.normals)
          geometry.setAttribute(
            "normal",
            new THREE.Float32BufferAttribute(paper.normals, 3),
          );
        else geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
      }
      // Close the exposed boundary with real side faces, not polygon offsets.
      const edgePositions: number[] = [];
      // Topology, rather than rectangular-grid indices, defines the boundary:
      // tilted creases add shared vertices and split triangles adaptively.
      for (const { a, b, faces } of this.outlineEdges) {
        if (faces.length !== 1) continue;
        for (const [v, front] of [
          [a, true],
          [b, true],
          [b, false],
          [a, true],
          [b, false],
          [a, false],
        ] as const) {
          const data = front ? this.position.array : backPosition.array;
          edgePositions.push(data[v * 3], data[v * 3 + 1], data[v * 3 + 2]);
        }
      }
      this.edgeGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(edgePositions, 3),
      );
      this.edgeGeometry.computeVertexNormals();
      this.edgeGeometry.computeBoundingSphere();
      const guideVertices: number[] = [];
      const rows =
        paper.creaseRows ?? (paper.pattern === "half" ? [9] : [6, 12]);
      for (const row of rows)
        for (let x = 0; x < paper.nx; x++)
          guideVertices.push(
            row * (paper.nx + 1) + x,
            row * (paper.nx + 1) + x + 1,
          );
      guideVertices.push(...(paper.creaseEdges ?? []));
      const lines: number[] = [];
      // Mark both physical faces. A tiny normal offset prevents z-fighting,
      // but stays far below the inter-layer clearance (0.15 * thickness).
      const offset = (paper.thickness ?? 0) * 0.52 + 1e-8;
      for (const side of [1, -1]) {
        for (const v of guideVertices)
          for (let k = 0; k < 3; k++) {
            const normal =
              paper.normals?.[v * 3 + k] ??
              this.geometry.getAttribute("normal").array[v * 3 + k];
            lines.push(paper.positions[v * 3 + k] + side * offset * normal);
          }
        const segments = paper.creaseSegments ?? [];
        for (let i = 0; i < segments.length; i++)
          lines.push(
            segments[i] +
              side *
                offset *
                (paper.creaseSegmentNormals?.[i] ?? (i % 3 === 2 ? 1 : 0)),
          );
      }
      this.creaseGeometry.dispose();
      this.creaseGeometry = new LineSegmentsGeometry();
      this.creaseGeometry.setPositions(
        lines.length ? lines : [0, 0, 0, 0, 0, 0],
      );
      this.creases.geometry = this.creaseGeometry;
      this.geometry.computeBoundingBox();
      const center = this.geometry.boundingBox!.getCenter(new THREE.Vector3());
      this.camera.position.add(center.clone().sub(this.controls.target));
      this.controls.target.copy(center);
    }
    if (this.followCamera) this.updateCameraSequence();
    else this.controls.update();
    this.updateSeal();
    this.updateBorders();
    this.renderer.render(this.scene, this.camera);
  }
  private updateBorders() {
    if (!this.borders.visible) return;
    const paper = this.simulation,
      camera = this.camera.position;
    const stamp = `${this.stateVersion}:${camera.x}:${camera.y}:${camera.z}:${this.camera.quaternion.toArray()}:${this.camera.projectionMatrix.elements}`;
    if (paper.stateVersion !== undefined && stamp === this.borderStamp) return;
    this.borderStamp = stamp;
    const p = paper.positions;
    for (let f = 0; f < this.faceSigns.length; f++) {
      const a = paper.indices[f * 3] * 3,
        b = paper.indices[f * 3 + 1] * 3,
        c = paper.indices[f * 3 + 2] * 3;
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2],
        vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const dot =
        nx * (camera.x - p[a]) +
        ny * (camera.y - p[a + 1]) +
        nz * (camera.z - p[a + 2]);
      this.faceSigns[f] = dot >= 0 ? 1 : -1;
    }
    const lines: number[] = [];
    const halfThickness = (paper.thickness ?? 0) / 2;
    for (const edge of this.outlineEdges) {
      // Paper perimeter plus view-dependent silhouettes of rounded folds.
      if (
        edge.faces.length > 1 &&
        this.faceSigns[edge.faces[0]] === this.faceSigns[edge.faces[1]]
      )
        continue;
      for (const v of [edge.a, edge.b]) {
        const i = v * 3,
          dx = camera.x - p[i],
          dy = camera.y - p[i + 1],
          dz = camera.z - p[i + 2],
          length = Math.hypot(dx, dy, dz);
        const normals =
          paper.normals ?? this.geometry.getAttribute("normal").array;
        const nx = normals[i],
          ny = normals[i + 1],
          nz = normals[i + 2];
        const side = nx * dx + ny * dy + nz * dz >= 0 ? 1 : -1;
        // Stay on this sheet's physical face. A view-ray lift divided by
        // incidence can cross several layers near a crooked, grazing crease.
        const offset = side * halfThickness;
        const clearance = Math.min(1e-8, halfThickness * 0.01);
        lines.push(
          p[i] + nx * offset + (dx / length) * clearance,
          p[i + 1] + ny * offset + (dy / length) * clearance,
          p[i + 2] + nz * offset + (dz / length) * clearance,
        );
      }
    }
    this.borderGeometry.dispose();
    this.borderGeometry = new LineSegmentsGeometry();
    const visible = visibleBorderSegments(
      lines,
      [
        this.geometry,
        this.backGeometry,
        this.edgeGeometry,
        ...(this.seal.visible ? [this.seal.geometry] : []),
      ],
      this.camera,
    );
    this.borderGeometry.setPositions(
      visible.length ? visible : [0, 0, 0, 0, 0, 0],
    );
    this.borders.geometry = this.borderGeometry;
  }
  dispose() {
    this.disposed = true;
    this.artworkRequest.front++;
    this.artworkRequest.back++;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.geometry.dispose();
    this.backGeometry.dispose();
    this.edgeGeometry.dispose();
    this.edgeMaterial.dispose();
    this.seal.geometry.dispose();
    this.seal.material.dispose();
    this.creaseGeometry.dispose();
    this.borderGeometry.dispose();
    this.borderMaterial.dispose();
    this.front.dispose();
    this.back.dispose();
    (this.wire.material as THREE.Material).dispose();
    (this.creases.material as THREE.Material).dispose();
    this.texture.dispose();
    this.backTexture?.dispose();
    this.keyLight.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
