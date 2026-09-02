import * as THREE from "three";

export interface OrbitCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

/** Capture the user-controlled parts of an OrbitControls camera. */
export function captureOrbitCameraPose(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
): OrbitCameraPose {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
    up: [camera.up.x, camera.up.y, camera.up.z],
  };
}

/** Restore orbit, pan, and zoom without applying a fitted camera preset. */
export function restoreOrbitCameraPose(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  pose: OrbitCameraPose,
): void {
  camera.position.set(...pose.position);
  camera.up.set(...pose.up);
  target.set(...pose.target);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}
