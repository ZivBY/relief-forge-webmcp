import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { captureOrbitCameraPose, restoreOrbitCameraPose } from "./camera-pose";

describe("Orbit camera pose persistence", () => {
  it("round-trips orbit, pan target, and zoom distance exactly", () => {
    const camera = new THREE.PerspectiveCamera(25, 1.7, 1, 5_000);
    camera.position.set(172.5, -83.25, 419.75);
    camera.up.set(0.1, 0.98, 0.03).normalize();
    const target = new THREE.Vector3(17.25, -9.5, 12.75);
    camera.lookAt(target);

    const pose = captureOrbitCameraPose(camera, target);
    const expectedDistance = camera.position.distanceTo(target);

    camera.position.set(0, 0, 1);
    camera.up.set(0, 1, 0);
    target.set(0, 0, 0);
    restoreOrbitCameraPose(camera, target, pose);

    expect(camera.position.toArray()).toEqual(pose.position);
    expect(camera.up.toArray()).toEqual(pose.up);
    expect(target.toArray()).toEqual(pose.target);
    expect(camera.position.distanceTo(target)).toBeCloseTo(expectedDistance, 12);
  });

  it("does not undo projection limits recalculated for new geometry", () => {
    const camera = new THREE.PerspectiveCamera(25, 1, 1, 2_000);
    camera.position.set(90, 55, 310);
    const target = new THREE.Vector3(8, -4, 16);
    const pose = captureOrbitCameraPose(camera, target);

    camera.near = 3.5;
    camera.far = 8_500;
    camera.aspect = 1.85;
    restoreOrbitCameraPose(camera, target, pose);

    expect(camera.near).toBe(3.5);
    expect(camera.far).toBe(8_500);
    expect(camera.aspect).toBe(1.85);
    expect(camera.position.toArray()).toEqual(pose.position);
    expect(target.toArray()).toEqual(pose.target);
  });
});
