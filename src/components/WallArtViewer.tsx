import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { GuideLineConfig, WallArtProject } from "../core/types";
import type { NormalizedPoint } from "../core/guide-fields";
import { rebuildGuidePath } from "../core/guide-presets";
import {
  captureOrbitCameraPose,
  restoreOrbitCameraPose,
  type OrbitCameraPose,
} from "./camera-pose";
import {
  maximumProjectHeight,
  shouldSuggestTopView,
} from "./viewer-presentation";

export type WallArtView = "reset" | "top" | "isometric";
export type WallArtMaterialPreview = "palette" | "neutral";
export type WallArtGuideMode = "select" | "draw" | "edit";

export interface WallArtViewerProps {
  project: WallArtProject | null;
  className?: string;
  backgroundColor?: string;
  showToolbar?: boolean;
  initialView?: Exclude<WallArtView, "reset">;
  guideLines?: readonly GuideLineConfig[];
  guideMode?: WallArtGuideMode;
  selectedGuideId?: string;
  onGuideSelected?: (id: string) => void;
  guideDrawingEnabled?: boolean;
  onGuideDrawn?: (points: readonly NormalizedPoint[]) => void;
  onGuideControlPointsChanged?: (
    id: string,
    controlPoints: readonly NormalizedPoint[],
  ) => void;
}

interface ColorGeometry {
  color: string;
  positions: number[];
  indices: number[];
}

const EMPTY_GUIDE_LINES: readonly GuideLineConfig[] = [];

function geometryByColor(project: WallArtProject): ColorGeometry[] {
  const groups = new Map<string, ColorGeometry>();

  for (const tile of project.tiles) {
    const color = tile.color || project.config.palette.colors[tile.colorIndex] || "#cbd5e1";
    const group = groups.get(color) ?? { color, positions: [], indices: [] };
    const vertexOffset = group.positions.length / 3;

    for (const vertex of tile.mesh.vertices) {
      group.positions.push(
        tile.centerXmm + vertex.x - project.widthMm / 2,
        project.depthMm / 2 - (tile.centerYmm + vertex.y),
        vertex.z,
      );
    }

    for (const triangle of tile.mesh.triangles) {
      // The generator's installation rows grow in +Y down the artwork. The
      // Three.js viewer reflects that axis into its +Y-up screen plane so the
      // assembly map still reads top-to-bottom. That reflection reverses
      // triangle winding; swap B/C here to keep outward faces and normals.
      group.indices.push(
        vertexOffset + triangle[0],
        vertexOffset + triangle[2],
        vertexOffset + triangle[1],
      );
    }

    groups.set(color, group);
  }

  return [...groups.values()];
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    if (object instanceof THREE.Light) object.dispose();
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

/**
 * Direct-Three.js preview of a generated project. Tile geometry is merged into
 * one draw call per color while retaining each tile's generated palette color.
 */
export function WallArtViewer({
  project,
  className = "",
  backgroundColor = "#eef2f6",
  showToolbar = true,
  initialView = "isometric",
  guideLines = EMPTY_GUIDE_LINES,
  guideMode,
  selectedGuideId,
  onGuideSelected,
  guideDrawingEnabled = false,
  onGuideDrawn,
  onGuideControlPointsChanged,
}: WallArtViewerProps) {
  const resolvedGuideMode: WallArtGuideMode = guideMode ?? (guideDrawingEnabled ? "draw" : "select");
  const viewportRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraPoseRef = useRef<OrbitCameraPose | null>(null);
  const previousInitialViewRef = useRef(initialView);
  const setViewRef = useRef<(view: WallArtView) => void>(() => undefined);
  const onGuideDrawnRef = useRef(onGuideDrawn);
  const onGuideSelectedRef = useRef(onGuideSelected);
  const onGuideControlPointsChangedRef = useRef(onGuideControlPointsChanged);
  const [activeView, setActiveView] = useState<Exclude<WallArtView, "reset">>(initialView);
  const [materialPreview, setMaterialPreview] = useState<WallArtMaterialPreview>("palette");
  const [viewerError, setViewerError] = useState<string>();

  useEffect(() => {
    onGuideDrawnRef.current = onGuideDrawn;
    onGuideSelectedRef.current = onGuideSelected;
    onGuideControlPointsChangedRef.current = onGuideControlPointsChanged;
  }, [onGuideControlPointsChanged, onGuideDrawn, onGuideSelected]);

  // Keep exactly one WebGL context for the lifetime of the viewer. Project
  // edits rebuild scene geometry, not the renderer; rapid slider/family edits
  // previously accumulated contexts until Chromium began losing them.
  useEffect(() => () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.dispose();
    renderer.domElement.remove();
    rendererRef.current = null;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!project || project.tiles.length === 0) {
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.clear();
        renderer.domElement.hidden = true;
      }
      setViewerError(undefined);
      setViewRef.current = () => undefined;
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);

    let renderer = rendererRef.current;
    if (!renderer) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        rendererRef.current = renderer;
      } catch {
        setViewerError("The 3D preview could not start because WebGL is unavailable. Your design and exports are still safe.");
        setViewRef.current = () => undefined;
        return;
      }
    }
    setViewerError(undefined);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "wall-art-viewer__canvas";
    renderer.domElement.hidden = false;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D wall art preview");
    if (!viewport.contains(renderer.domElement)) viewport.appendChild(renderer.domElement);

    const maximumDimension = Math.max(project.widthMm, project.depthMm, 1);
    const maximumHeight = Math.max(maximumProjectHeight(project), 1);
    const camera = new THREE.PerspectiveCamera(
      25,
      1,
      // A 0.1 mm near plane against a 15 m far plane destroyed depth-buffer
      // precision and made low relief facets z-fight with the backboard.
      Math.max(1, maximumDimension * 0.01),
      maximumDimension * 12 + maximumHeight * 4,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.minDistance = maximumDimension * 0.25;
    controls.maxDistance = maximumDimension * 8;

    const rememberCameraPose = () => {
      cameraPoseRef.current = captureOrbitCameraPose(camera, controls.target);
    };

    // Render only when scene or camera state changes. OrbitControls.update()
    // returns true while damping is still moving, so interaction remains
    // smooth without keeping the GPU busy after the camera settles.
    let animationFrame = 0;
    let contextLost = false;
    let disposed = false;
    const render = () => {
      animationFrame = 0;
      if (disposed || contextLost) return;
      const dampingChanged = controls.update();
      renderer.render(scene, camera);
      if (dampingChanged) invalidate();
    };
    const invalidate = () => {
      if (disposed || contextLost || animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(render);
    };

    const artGroup = new THREE.Group();
    artGroup.name = "generated-wall-art";
    for (const group of geometryByColor(project)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(group.positions, 3));
      geometry.setIndex(group.indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();

      const previewColor = materialPreview === "neutral" ? "#d7c4a2" : group.color;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(previewColor),
        roughness: 0.76,
        metalness: 0,
        // Slicers and printed parts use the exported triangle planes. Never
        // interpolate normals here: that creates rounded shapes which do not
        // physically exist in the STL/3MF and breaks visual export parity.
        flatShading: true,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      artGroup.add(mesh);
    }
    scene.add(artGroup);

    const guideZ = maximumHeight + Math.max(0.8, maximumDimension * 0.004);
    const unselectedGuideMaterial = new THREE.LineBasicMaterial({
      color: "#8f7771",
      linewidth: 1,
      depthTest: false,
      transparent: true,
      opacity: selectedGuideId ? 0.48 : 0.82,
    });
    const selectedGuideMaterial = new THREE.LineBasicMaterial({
      color: "#dc4f32",
      linewidth: 3,
      depthTest: false,
      transparent: true,
      opacity: 1,
    });
    const draftGuideMaterial = new THREE.LineBasicMaterial({
      color: "#f97350",
      linewidth: 3,
      depthTest: false,
      transparent: true,
      opacity: 1,
    });
    unselectedGuideMaterial.depthWrite = false;
    selectedGuideMaterial.depthWrite = false;
    draftGuideMaterial.depthWrite = false;
    const guidePointPosition = (point: NormalizedPoint): [number, number, number] => [
      point.x * project.widthMm / 2,
      point.y * project.depthMm / 2,
      guideZ,
    ];
    const guidePathGeometry = (
      points: readonly NormalizedPoint[],
      closed: boolean,
    ): THREE.BufferGeometry => {
      const evaluatedPoints = closed && points.length > 0
        ? [...points, points[0]]
        : [...points];
      return new THREE.BufferGeometry().setFromPoints(
        evaluatedPoints.map((point) => new THREE.Vector3(...guidePointPosition(point))),
      );
    };
    const setGuidePathGeometry = (
      object: THREE.Line,
      points: readonly NormalizedPoint[],
      closed: boolean,
    ) => {
      const previousGeometry = object.geometry;
      object.geometry = guidePathGeometry(points, closed);
      previousGeometry.dispose();
    };
    const disposeObjectResources = (object: THREE.Object3D) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      });
    };
    const clearGroup = (group: THREE.Group) => {
      for (const child of [...group.children]) {
        group.remove(child);
        disposeObjectResources(child);
      }
    };

    const guideObjects: THREE.Line[] = [];
    const guideObjectById = new Map<string, THREE.Line>();
    const guideConfigById = new Map(guideLines.map((line) => [line.id, line]));
    const directionMarkerById = new Map<string, THREE.Group>();
    const markerRadiusMm = THREE.MathUtils.clamp(maximumDimension * 0.009, 2.2, 6.5);
    const arrowLengthMm = markerRadiusMm * 3.2;

    const rebuildDirectionMarkers = (
      group: THREE.Group,
      guide: GuideLineConfig,
      points: readonly NormalizedPoint[],
      selected: boolean,
    ) => {
      clearGroup(group);
      if (guide.effects?.directionMode !== "toward-forward" || points.length < 2) return;

      const markerColor = selected ? "#0f766e" : "#347c78";
      const start = new THREE.Vector3(...guidePointPosition(points[0]));
      start.z += Math.max(0.08, maximumDimension * 0.0003);
      const startMarker = new THREE.Mesh(
        new THREE.RingGeometry(markerRadiusMm * 0.48, markerRadiusMm, 20),
        new THREE.MeshBasicMaterial({
          color: markerColor,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: selected ? 1 : 0.78,
        }),
      );
      startMarker.position.copy(start);
      startMarker.renderOrder = 103;
      startMarker.name = `guide-${guide.id}-start`;
      group.add(startMarker);

      let anchorIndex = points.length - 1;
      let beforeIndex = Math.max(0, anchorIndex - 1);
      let afterIndex = anchorIndex;
      if (guide.closed) {
        anchorIndex = Math.floor(points.length * 0.25) % points.length;
        beforeIndex = (anchorIndex - 1 + points.length) % points.length;
        afterIndex = (anchorIndex + 1) % points.length;
      }
      const anchor = new THREE.Vector2(
        points[anchorIndex].x * project.widthMm / 2,
        points[anchorIndex].y * project.depthMm / 2,
      );
      const before = new THREE.Vector2(
        points[beforeIndex].x * project.widthMm / 2,
        points[beforeIndex].y * project.depthMm / 2,
      );
      const after = new THREE.Vector2(
        points[afterIndex].x * project.widthMm / 2,
        points[afterIndex].y * project.depthMm / 2,
      );
      const direction = after.sub(before);
      if (direction.lengthSq() <= 1e-10) return;
      direction.normalize();
      const normal = new THREE.Vector2(-direction.y, direction.x);
      const tip = guide.closed
        ? anchor.clone().addScaledVector(direction, arrowLengthMm * 0.55)
        : anchor.clone();
      const baseCenter = guide.closed
        ? anchor.clone().addScaledVector(direction, -arrowLengthMm * 0.55)
        : anchor.clone().addScaledVector(direction, -arrowLengthMm);
      const left = baseCenter.clone().addScaledVector(normal, markerRadiusMm * 0.9);
      const right = baseCenter.clone().addScaledVector(normal, -markerRadiusMm * 0.9);
      const arrowGeometry = new THREE.BufferGeometry();
      arrowGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([
          tip.x, tip.y, guideZ + Math.max(0.1, maximumDimension * 0.0004),
          left.x, left.y, guideZ + Math.max(0.1, maximumDimension * 0.0004),
          right.x, right.y, guideZ + Math.max(0.1, maximumDimension * 0.0004),
        ], 3),
      );
      arrowGeometry.setIndex([0, 1, 2]);
      const arrow = new THREE.Mesh(
        arrowGeometry,
        new THREE.MeshBasicMaterial({
          color: markerColor,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: selected ? 1 : 0.78,
        }),
      );
      arrow.renderOrder = 104;
      arrow.name = guide.closed
        ? `guide-${guide.id}-winding-arrow`
        : `guide-${guide.id}-end-arrow`;
      group.add(arrow);
    };

    for (const guide of guideLines) {
      const selected = guide.id === selectedGuideId;
      const line = new THREE.Line(
        guidePathGeometry(guide.points, guide.closed),
        selected ? selectedGuideMaterial : unselectedGuideMaterial,
      );
      line.renderOrder = selected ? 102 : 100;
      line.name = `guide-${guide.id}`;
      line.userData.guideId = guide.id;
      scene.add(line);
      guideObjects.push(line);
      guideObjectById.set(guide.id, line);

      const markerGroup = new THREE.Group();
      markerGroup.name = `guide-${guide.id}-direction-markers`;
      rebuildDirectionMarkers(markerGroup, guide, guide.points, selected);
      scene.add(markerGroup);
      directionMarkerById.set(guide.id, markerGroup);
    }

    const backboard = new THREE.Mesh(
      new THREE.PlaneGeometry(project.widthMm * 1.08, project.depthMm * 1.08),
      new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.92 }),
    );
    backboard.position.z = -Math.max(1.2, maximumHeight * 0.04);
    backboard.receiveShadow = true;
    scene.add(backboard);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(maximumDimension * 2.4, maximumDimension * 1.4),
      new THREE.MeshStandardMaterial({ color: "#dce2e8", roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -project.depthMm * 0.58, maximumDimension * 0.28);
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.HemisphereLight("#ffffff", "#8c99a8", 1.45));
    const keyLight = new THREE.DirectionalLight("#fff7e8", 3.2);
    keyLight.position.set(-maximumDimension, maximumDimension * 1.2, maximumDimension * 1.7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -maximumDimension;
    keyLight.shadow.camera.right = maximumDimension;
    keyLight.shadow.camera.top = maximumDimension;
    keyLight.shadow.camera.bottom = -maximumDimension;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = maximumDimension * 5;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = Math.max(0.4, maximumDimension * 0.0015);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#d7e8ff", 1.25);
    fillLight.position.set(maximumDimension, -maximumDimension * 0.2, maximumDimension);
    scene.add(fillLight);

    const applyView = (requestedView: WallArtView) => {
      const view = requestedView === "reset" ? initialView : requestedView;

      const aspect = Math.max(camera.aspect, 0.2);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      const boundingRadius = Math.hypot(
        project.widthMm * 0.54,
        project.depthMm * 0.54,
        maximumHeight * 0.55,
      );
      const fitDistance = (boundingRadius / Math.sin(limitingFov / 2)) * 1.08;
      const target = new THREE.Vector3(0, 0, maximumHeight * 0.3);

      if (view === "top") {
        camera.position.set(0, 0, target.z + fitDistance);
        camera.up.set(0, 1, 0);
      } else {
        const direction = new THREE.Vector3(0.62, 0.42, 1).normalize();
        camera.position.copy(target).addScaledVector(direction, fitDistance);
        camera.up.set(0, 1, 0);
      }

      controls.target.copy(target);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      controls.update();
      rememberCameraPose();
      setActiveView(view);
      invalidate();
    };
    setViewRef.current = (view) => applyView(resolvedGuideMode === "select" ? view : "top");

    controls.enabled = resolvedGuideMode === "select";
    renderer.domElement.style.cursor = resolvedGuideMode === "draw"
      ? "crosshair"
      : resolvedGuideMode === "edit"
        ? "default"
        : "grab";
    const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -guideZ);
    const raycaster = new THREE.Raycaster();
    const lineHitRadiusMm = THREE.MathUtils.clamp(maximumDimension * 0.012, 3, 11);
    const handleHitRadiusMm = THREE.MathUtils.clamp(maximumDimension * 0.018, 4.5, 14);
    raycaster.params.Line.threshold = lineHitRadiusMm;
    const pointerNdc = new THREE.Vector2();
    const pointerHit = new THREE.Vector3();

    const setPointerRay = (event: PointerEvent): boolean => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return false;
      pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(pointerNdc, camera);
      return true;
    };

    const normalizedGuidePoint = (
      event: PointerEvent,
      clampToArt = true,
    ): NormalizedPoint | undefined => {
      if (!setPointerRay(event)) return undefined;
      if (!raycaster.ray.intersectPlane(pointerPlane, pointerHit)) return undefined;
      const x = pointerHit.x / (project.widthMm / 2);
      const y = pointerHit.y / (project.depthMm / 2);
      return {
        x: clampToArt ? THREE.MathUtils.clamp(x, -1, 1) : x,
        y: clampToArt ? THREE.MathUtils.clamp(y, -1, 1) : y,
      };
    };

    const physicalDistance = (left: NormalizedPoint, right: NormalizedPoint): number =>
      Math.hypot(
        (right.x - left.x) * project.widthMm / 2,
        (right.y - left.y) * project.depthMm / 2,
      );
    const clonePoints = (points: readonly NormalizedPoint[]): NormalizedPoint[] =>
      points.map((point) => ({ x: point.x, y: point.y }));
    const releasePointer = (pointerId: number) => {
      try {
        if (renderer.domElement.hasPointerCapture?.(pointerId)) {
          renderer.domElement.releasePointerCapture(pointerId);
        }
      } catch {
        // The browser can implicitly release capture when the window loses focus.
      }
    };
    const guideNearPointer = (event: PointerEvent): string | undefined => {
      if (!setPointerRay(event)) return undefined;
      const intersection = raycaster.intersectObjects(guideObjects, false)[0];
      return typeof intersection?.object.userData.guideId === "string"
        ? intersection.object.userData.guideId
        : undefined;
    };

    let drawPointerId: number | undefined;
    let drawPoints: NormalizedPoint[] = [];
    let drawDraftLine: THREE.Line | undefined;
    const removeDrawDraft = () => {
      if (!drawDraftLine) return;
      scene.remove(drawDraftLine);
      drawDraftLine.geometry.dispose();
      drawDraftLine = undefined;
    };
    const updateDrawDraft = () => {
      if (drawPoints.length < 2) {
        removeDrawDraft();
        invalidate();
        return;
      }
      if (!drawDraftLine) {
        drawDraftLine = new THREE.Line(
          guidePathGeometry(drawPoints, false),
          draftGuideMaterial,
        );
        drawDraftLine.renderOrder = 105;
        drawDraftLine.name = "guide-draw-draft";
        scene.add(drawDraftLine);
      } else {
        setGuidePathGeometry(drawDraftLine, drawPoints, false);
      }
      invalidate();
    };

    const selectedGuide = selectedGuideId
      ? guideConfigById.get(selectedGuideId)
      : undefined;
    const selectedGuideObject = selectedGuide
      ? guideObjectById.get(selectedGuide.id)
      : undefined;
    const selectedDirectionMarkers = selectedGuide
      ? directionMarkerById.get(selectedGuide.id)
      : undefined;
    const controlHandleGroup = new THREE.Group();
    controlHandleGroup.name = "guide-control-handles";
    scene.add(controlHandleGroup);
    let currentControlPoints = selectedGuide
      ? clonePoints(selectedGuide.controlPoints ?? selectedGuide.points)
      : [];
    let currentEvaluatedPoints = selectedGuide
      ? clonePoints(selectedGuide.points)
      : [];
    const handleRadiusMm = THREE.MathUtils.clamp(maximumDimension * 0.012, 3, 8);

    const rebuildControlHandles = (controlPoints: readonly NormalizedPoint[]) => {
      if (resolvedGuideMode !== "edit" || !selectedGuide) {
        clearGroup(controlHandleGroup);
        return;
      }
      if (controlHandleGroup.children.length === controlPoints.length * 2) {
        for (const [index, point] of controlPoints.entries()) {
          const outer = controlHandleGroup.children[index * 2];
          const center = controlHandleGroup.children[index * 2 + 1];
          outer.position.set(...guidePointPosition(point));
          outer.position.z += Math.max(0.18, maximumDimension * 0.00055);
          center.position.copy(outer.position);
          center.position.z += Math.max(0.04, maximumDimension * 0.0001);
        }
        return;
      }
      clearGroup(controlHandleGroup);
      for (const [index, point] of controlPoints.entries()) {
        const outer = new THREE.Mesh(
          new THREE.CircleGeometry(handleRadiusMm, 20),
          new THREE.MeshBasicMaterial({
            color: "#fff7ed",
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        outer.position.set(...guidePointPosition(point));
        outer.position.z += Math.max(0.18, maximumDimension * 0.00055);
        outer.renderOrder = 107;
        outer.name = `guide-${selectedGuide.id}-handle-${index}`;
        outer.userData.handleIndex = index;
        controlHandleGroup.add(outer);

        const center = new THREE.Mesh(
          new THREE.CircleGeometry(handleRadiusMm * 0.46, 16),
          new THREE.MeshBasicMaterial({
            color: "#c2412d",
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        center.position.copy(outer.position);
        center.position.z += Math.max(0.04, maximumDimension * 0.0001);
        center.renderOrder = 108;
        center.name = `guide-${selectedGuide.id}-handle-center-${index}`;
        center.userData.handleIndex = index;
        controlHandleGroup.add(center);
      }
    };
    rebuildControlHandles(currentControlPoints);

    const nearestHandleIndex = (point: NormalizedPoint): number | undefined => {
      let result: number | undefined;
      let nearestDistance = handleHitRadiusMm;
      for (const [index, controlPoint] of currentControlPoints.entries()) {
        const distance = physicalDistance(point, controlPoint);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          result = index;
        }
      }
      return result;
    };

    interface SegmentHit {
      insertIndex: number;
      point: NormalizedPoint;
      distanceMm: number;
    }
    const nearestControlSegment = (point: NormalizedPoint): SegmentHit | undefined => {
      if (!selectedGuide || currentControlPoints.length < 2) return undefined;
      const segmentCount = selectedGuide.closed
        ? currentControlPoints.length
        : currentControlPoints.length - 1;
      const px = point.x * project.widthMm / 2;
      const py = point.y * project.depthMm / 2;
      let nearest: SegmentHit | undefined;
      for (let index = 0; index < segmentCount; index += 1) {
        const start = currentControlPoints[index];
        const end = currentControlPoints[(index + 1) % currentControlPoints.length];
        const ax = start.x * project.widthMm / 2;
        const ay = start.y * project.depthMm / 2;
        const dx = (end.x - start.x) * project.widthMm / 2;
        const dy = (end.y - start.y) * project.depthMm / 2;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 1e-10) continue;
        const t = THREE.MathUtils.clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
        const projectedX = ax + dx * t;
        const projectedY = ay + dy * t;
        const distanceMm = Math.hypot(px - projectedX, py - projectedY);
        if (!nearest || distanceMm < nearest.distanceMm) {
          nearest = {
            insertIndex: index + 1,
            point: {
              x: start.x + (end.x - start.x) * t,
              y: start.y + (end.y - start.y) * t,
            },
            distanceMm,
          };
        }
      }
      return nearest && nearest.distanceMm <= lineHitRadiusMm ? nearest : undefined;
    };

    let editPointerId: number | undefined;
    let editHandleIndex: number | undefined;
    let editOriginalControlPoints: NormalizedPoint[] = [];
    let editOriginalEvaluatedPoints: NormalizedPoint[] = [];
    let editDraftControlPoints: NormalizedPoint[] = [];
    let editDraftEvaluatedPoints: NormalizedPoint[] = [];
    let editDraftLine: THREE.Line | undefined;

    const removeEditDraft = () => {
      if (!editDraftLine) return;
      scene.remove(editDraftLine);
      editDraftLine.geometry.dispose();
      editDraftLine = undefined;
    };
    const updateEditDraft = (nextControlPoints: readonly NormalizedPoint[]): boolean => {
      if (!selectedGuide || !selectedGuideObject) return false;
      let evaluated: NormalizedPoint[];
      try {
        evaluated = rebuildGuidePath(
          nextControlPoints,
          selectedGuide.closed,
          selectedGuide.interpolation ?? "linear",
        );
      } catch {
        return false;
      }
      editDraftControlPoints = clonePoints(nextControlPoints);
      editDraftEvaluatedPoints = clonePoints(evaluated);
      if (!editDraftLine) {
        editDraftLine = new THREE.Line(
          guidePathGeometry(evaluated, selectedGuide.closed),
          draftGuideMaterial,
        );
        editDraftLine.renderOrder = 106;
        editDraftLine.name = `guide-${selectedGuide.id}-edit-draft`;
        scene.add(editDraftLine);
      } else {
        setGuidePathGeometry(editDraftLine, evaluated, selectedGuide.closed);
      }
      selectedGuideObject.visible = false;
      rebuildControlHandles(editDraftControlPoints);
      if (selectedDirectionMarkers) {
        rebuildDirectionMarkers(selectedDirectionMarkers, selectedGuide, evaluated, true);
      }
      invalidate();
      return true;
    };
    const beginEdit = (
      event: PointerEvent,
      nextControlPoints: readonly NormalizedPoint[],
      draggedHandleIndex?: number,
    ) => {
      if (!selectedGuide || !selectedGuideObject) return;
      editOriginalControlPoints = clonePoints(currentControlPoints);
      editOriginalEvaluatedPoints = clonePoints(currentEvaluatedPoints);
      if (!updateEditDraft(nextControlPoints)) return;
      editPointerId = event.pointerId;
      editHandleIndex = draggedHandleIndex;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      renderer.domElement.style.cursor = draggedHandleIndex === undefined ? "default" : "grabbing";
    };
    const endEdit = (event: PointerEvent, commit: boolean) => {
      if (
        editPointerId !== event.pointerId ||
        !selectedGuide ||
        !selectedGuideObject
      ) return;
      releasePointer(event.pointerId);
      const committedControlPoints = clonePoints(editDraftControlPoints);
      if (commit) {
        currentControlPoints = committedControlPoints;
        currentEvaluatedPoints = clonePoints(editDraftEvaluatedPoints);
        setGuidePathGeometry(selectedGuideObject, currentEvaluatedPoints, selectedGuide.closed);
      } else {
        currentControlPoints = clonePoints(editOriginalControlPoints);
        currentEvaluatedPoints = clonePoints(editOriginalEvaluatedPoints);
      }
      selectedGuideObject.visible = true;
      removeEditDraft();
      rebuildControlHandles(currentControlPoints);
      if (selectedDirectionMarkers) {
        rebuildDirectionMarkers(
          selectedDirectionMarkers,
          selectedGuide,
          currentEvaluatedPoints,
          true,
        );
      }
      editPointerId = undefined;
      editHandleIndex = undefined;
      renderer.domElement.style.cursor = "default";
      invalidate();
      if (commit) {
        onGuideControlPointsChangedRef.current?.(
          selectedGuide.id,
          committedControlPoints,
        );
      }
    };

    let selectPointerId: number | undefined;
    let selectCandidateId: string | undefined;
    let selectStartX = 0;
    let selectStartY = 0;
    let selectMoved = false;

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (resolvedGuideMode === "select") {
        selectPointerId = event.pointerId;
        selectCandidateId = guideNearPointer(event);
        selectStartX = event.clientX;
        selectStartY = event.clientY;
        selectMoved = false;
        return;
      }

      event.preventDefault();
      const point = normalizedGuidePoint(event, resolvedGuideMode !== "edit");
      if (!point) return;
      if (resolvedGuideMode === "draw") {
        drawPointerId = event.pointerId;
        drawPoints = [point];
        renderer.domElement.setPointerCapture?.(event.pointerId);
        return;
      }
      if (!selectedGuide || !selectedGuideObject) return;

      const handleIndex = nearestHandleIndex(point);
      if (handleIndex !== undefined) {
        if (event.altKey) {
          const minimumPoints = selectedGuide.closed ? 3 : 2;
          if (currentControlPoints.length <= minimumPoints) return;
          const nextControlPoints = clonePoints(currentControlPoints);
          nextControlPoints.splice(handleIndex, 1);
          beginEdit(event, nextControlPoints);
        } else {
          beginEdit(event, currentControlPoints, handleIndex);
        }
        return;
      }

      const segment = nearestControlSegment(point);
      if (!segment) return;
      const nextControlPoints = clonePoints(currentControlPoints);
      nextControlPoints.splice(segment.insertIndex, 0, segment.point);
      beginEdit(event, nextControlPoints, segment.insertIndex);
    };
    const pointerMove = (event: PointerEvent) => {
      if (resolvedGuideMode === "select") {
        if (selectPointerId === event.pointerId && !selectMoved) {
          selectMoved = Math.hypot(
            event.clientX - selectStartX,
            event.clientY - selectStartY,
          ) > 5;
        }
        return;
      }
      if (resolvedGuideMode === "draw") {
        if (drawPointerId !== event.pointerId) return;
        event.preventDefault();
        const point = normalizedGuidePoint(event);
        if (!point) return;
        const previous = drawPoints[drawPoints.length - 1];
        const sampleSpacingMm = THREE.MathUtils.clamp(maximumDimension * 0.004, 1, 4);
        if (!previous || physicalDistance(previous, point) >= sampleSpacingMm) {
          drawPoints.push(point);
          updateDrawDraft();
        }
        return;
      }
      if (editPointerId !== event.pointerId || editHandleIndex === undefined) return;
      event.preventDefault();
      const point = normalizedGuidePoint(event);
      if (!point) return;
      const nextControlPoints = clonePoints(editDraftControlPoints);
      const previousIndex = (editHandleIndex - 1 + nextControlPoints.length) % nextControlPoints.length;
      const nextIndex = (editHandleIndex + 1) % nextControlPoints.length;
      if (
        physicalDistance(point, nextControlPoints[previousIndex]) < 0.01 ||
        physicalDistance(point, nextControlPoints[nextIndex]) < 0.01
      ) {
        return;
      }
      nextControlPoints[editHandleIndex] = point;
      updateEditDraft(nextControlPoints);
    };
    const pointerUp = (event: PointerEvent) => {
      if (resolvedGuideMode === "select") {
        if (selectPointerId !== event.pointerId) return;
        const candidate = !selectMoved && guideNearPointer(event) === selectCandidateId
          ? selectCandidateId
          : undefined;
        selectPointerId = undefined;
        selectCandidateId = undefined;
        if (candidate) onGuideSelectedRef.current?.(candidate);
        return;
      }
      if (resolvedGuideMode === "draw") {
        if (drawPointerId !== event.pointerId) return;
        event.preventDefault();
        releasePointer(event.pointerId);
        drawPointerId = undefined;
        const committedPoints = clonePoints(drawPoints);
        drawPoints = [];
        removeDrawDraft();
        invalidate();
        if (committedPoints.length >= 2) onGuideDrawnRef.current?.(committedPoints);
        return;
      }
      event.preventDefault();
      endEdit(event, true);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (resolvedGuideMode === "select") {
        if (selectPointerId === event.pointerId) {
          selectPointerId = undefined;
          selectCandidateId = undefined;
        }
        return;
      }
      if (resolvedGuideMode === "draw") {
        if (drawPointerId !== event.pointerId) return;
        releasePointer(event.pointerId);
        drawPointerId = undefined;
        drawPoints = [];
        removeDrawDraft();
        invalidate();
        return;
      }
      endEdit(event, false);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);

    const resize = () => {
      const width = Math.max(viewport.clientWidth, 1);
      const height = Math.max(viewport.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(viewport);
    window.addEventListener("resize", resize);

    const handleControlsChange = () => {
      rememberCameraPose();
      invalidate();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      setViewerError("The 3D preview lost its graphics context. Your design is safe; waiting for graphics recovery.");
    };
    const handleContextRestored = () => {
      contextLost = false;
      setViewerError(undefined);
      invalidate();
    };
    controls.addEventListener("change", handleControlsChange);
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored);
    const initialViewChanged = previousInitialViewRef.current !== initialView;
    previousInitialViewRef.current = initialView;
    resize();
    if (resolvedGuideMode !== "select") {
      applyView("top");
    } else if (cameraPoseRef.current && !initialViewChanged) {
      restoreOrbitCameraPose(camera, controls.target, cameraPoseRef.current);
      controls.update();
      rememberCameraPose();
      invalidate();
    } else {
      applyView(initialView);
    }
    invalidate();

    return () => {
      rememberCameraPose();
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      controls.removeEventListener("change", handleControlsChange);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      renderer.domElement.style.cursor = "";
      if (drawPointerId !== undefined) releasePointer(drawPointerId);
      if (editPointerId !== undefined) releasePointer(editPointerId);
      removeDrawDraft();
      removeEditDraft();
      disposeScene(scene);
      unselectedGuideMaterial.dispose();
      selectedGuideMaterial.dispose();
      draftGuideMaterial.dispose();
      setViewRef.current = () => undefined;
    };
  }, [
    backgroundColor,
    guideLines,
    initialView,
    materialPreview,
    project,
    resolvedGuideMode,
    selectedGuideId,
  ]);

  const setView = (view: WallArtView) => setViewRef.current(view);
  const rootClassName = ["wall-art-viewer", className].filter(Boolean).join(" ");
  const highAspectPreview = useMemo(
    () => Boolean(project && shouldSuggestTopView(project)),
    [project],
  );
  const showTopViewSuggestion = Boolean(
    highAspectPreview &&
    activeView === "isometric" &&
    resolvedGuideMode === "select",
  );

  return (
    <section className={rootClassName} aria-label="3D wall art viewer">
      {showToolbar && (
        <div className="wall-art-viewer__toolbar" role="toolbar" aria-label="3D view controls">
          <button type="button" className="wall-art-viewer__view-button" aria-label="Reset 3D view" title="Return to the default fitted camera view" onClick={() => setView("reset")}>
            Reset view
          </button>
          <button
            type="button"
            className="wall-art-viewer__view-button"
            aria-pressed={activeView === "top"}
            title="Look straight down at the exact assembled X/Y layout"
            onClick={() => setView("top")}
          >
            Top
          </button>
          <button
            type="button"
            className="wall-art-viewer__view-button"
            aria-pressed={activeView === "isometric"}
            title="Inspect height, facets, and shadows from an angled 3D view"
            onClick={() => setView("isometric")}
          >
            Isometric
          </button>
          <button
            type="button"
            className="wall-art-viewer__view-button"
            aria-pressed={materialPreview === "palette"}
            title="Preview the configured color palette"
            onClick={() => setMaterialPreview("palette")}
          >
            Color
          </button>
          <button
            type="button"
            className="wall-art-viewer__view-button"
            aria-pressed={materialPreview === "neutral"}
            title="Review geometry without palette contrast"
            onClick={() => setMaterialPreview("neutral")}
          >
            Neutral
          </button>
          <span
            className="wall-art-viewer__parity-badge"
            title="The viewer is rendering the exact exported triangle planes used by STL and 3MF"
          >
            EXPORT GEOMETRY
          </span>
        </div>
      )}
      {showTopViewSuggestion ? (
        <div className="wall-art-viewer__view-suggestion" role="status">
          <span>
            Tall, dense relief can overlap at this angle. Top view reveals the
            composition; export geometry stays unchanged.
          </span>
          <button type="button" onClick={() => setView("top")}>
            Show Top
          </button>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className="wall-art-viewer__viewport"
        style={{ minHeight: 380, position: "relative" }}
      >
        {!project || project.tiles.length === 0 ? (
          <p className="wall-art-viewer__empty">Generate a design to see its 3D preview.</p>
        ) : null}
        {viewerError ? (
          <p className="wall-art-viewer__error" role="alert">{viewerError}</p>
        ) : null}
      </div>
    </section>
  );
}

export default WallArtViewer;
