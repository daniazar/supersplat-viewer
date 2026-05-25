import { Vec3 } from 'playcanvas';

import type { Global } from './types';
import type { Viewer } from './viewer';

type Vector3Array = [number, number, number];

type ViewerCommand =
    | { type: 'SET_CAMERA'; position: Vector3Array; target: Vector3Array; fov?: number }
    | { type: 'SET_PERFORMANCE_MODE'; enabled: boolean }
    | { type: 'PLAY_ANIM'; trackName?: string }
    | { type: 'PAUSE_ANIM' }
    | { type: 'UPDATE_SETTINGS'; settings: Record<string, unknown> }
    | { type: 'SET_TIME_OF_DAY'; value: number }
    | { type: 'MOVE_CAMERA'; vector: { x: number; z: number }; deltaSeconds: number }
    | { type: 'ROTATE_CAMERA'; yawDelta: number; pitchDelta: number }
    | { type: 'SET_FOV'; fov: number }
    | { type: 'TAP_TELEPORT'; screen: { x: number; y: number } }
    | { type: 'BEGIN_MEASUREMENT' }
    | { type: 'END_MEASUREMENT' };

const focusTarget = new Vec3();
const moveForward = new Vec3();
const moveRight = new Vec3();
const moveDelta = new Vec3();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const postToParent = (message: Record<string, unknown>) => {
    window.parent?.postMessage(message, '*');
};

const cameraPosition = (global: Global): Vector3Array => {
    const position = global.camera.getPosition();
    return [position.x, position.y, position.z];
};

const emitCameraUpdate = (global: Global) => {
    const angles = global.camera.getEulerAngles();
    postToParent({
        type: 'CAMERA_UPDATE',
        position: cameraPosition(global),
        yaw: angles.y,
        pitch: angles.x
    });
};

const initPostMessageBridge = (viewer: Viewer) => {
    const { global } = viewer;
    const { app, camera, state, events } = global;

    const handleMessage = (event: MessageEvent<ViewerCommand>) => {
        const command = event.data;
        if (!command || typeof command !== 'object' || !('type' in command)) {
            return;
        }

        switch (command.type) {
            case 'SET_CAMERA':
                if (!viewer.cameraManager) {
                    return;
                }
                focusTarget.set(command.target[0], command.target[1], command.target[2]);
                viewer.cameraManager?.camera.look(
                    new Vec3(command.position[0], command.position[1], command.position[2]),
                    focusTarget
                );
                if (command.fov) {
                    viewer.cameraManager.camera.fov = command.fov;
                }
                const targetMode = state.walkAllowed ? 'walk' : 'fly';
                const modeChanged = state.cameraMode !== targetMode;
                state.cameraMode = targetMode;
                
                if (!modeChanged) {
                    const activeControllerSet = viewer.cameraManager.getController(state.cameraMode) as any;
                    if (activeControllerSet && typeof activeControllerSet.goto === 'function') {
                        activeControllerSet.goto(viewer.cameraManager.camera);
                    }
                }

                camera.setPosition(command.position[0], command.position[1], command.position[2]);
                camera.setEulerAngles(viewer.cameraManager.camera.angles);
                if (command.fov && camera.camera) {
                    camera.camera.fov = command.fov;
                }
                app.renderNextFrame = true;
                emitCameraUpdate(global);
                break;
            case 'MOVE_CAMERA':
                if (!viewer.cameraManager) {
                    return;
                }
                moveForward.copy(camera.forward);
                moveForward.y = 0;
                if (moveForward.lengthSq() > 0) {
                    moveForward.normalize();
                }
                moveRight.copy(camera.right);
                moveRight.y = 0;
                if (moveRight.lengthSq() > 0) {
                    moveRight.normalize();
                }
                moveDelta
                .copy(moveForward)
                .mulScalar(command.vector.z)
                .add(moveRight.mulScalar(command.vector.x))
                .mulScalar(command.deltaSeconds * 2.5);
                viewer.cameraManager.camera.position.add(moveDelta);
                
                const activeControllerMove = viewer.cameraManager.getController(state.cameraMode) as any;
                if (activeControllerMove && typeof activeControllerMove.goto === 'function') {
                    activeControllerMove.goto(viewer.cameraManager.camera);
                }

                camera.setPosition(viewer.cameraManager.camera.position);
                app.renderNextFrame = true;
                emitCameraUpdate(global);
                break;
            case 'ROTATE_CAMERA':
                if (!viewer.cameraManager) {
                    return;
                }
                viewer.cameraManager.camera.angles.y += command.yawDelta;
                viewer.cameraManager.camera.angles.x = clamp(
                    viewer.cameraManager.camera.angles.x + command.pitchDelta,
                    -85,
                    85
                );
                
                const activeControllerRotate = viewer.cameraManager.getController(state.cameraMode) as any;
                if (activeControllerRotate && typeof activeControllerRotate.goto === 'function') {
                    activeControllerRotate.goto(viewer.cameraManager.camera);
                }

                camera.setEulerAngles(viewer.cameraManager.camera.angles);
                app.renderNextFrame = true;
                emitCameraUpdate(global);
                break;
            case 'SET_FOV':
                if (!viewer.cameraManager) {
                    return;
                }
                viewer.cameraManager.camera.fov = clamp(command.fov, 45, 85);
                
                const activeControllerFov = viewer.cameraManager.getController(state.cameraMode) as any;
                if (activeControllerFov) {
                    activeControllerFov.fov = viewer.cameraManager.camera.fov;
                }

                if (camera.camera) {
                    camera.camera.fov = viewer.cameraManager.camera.fov;
                }
                app.renderNextFrame = true;
                break;
            case 'TAP_TELEPORT':
                if (!viewer.cameraManager) {
                    return;
                }
                moveForward.copy(camera.forward);
                moveForward.y = 0;
                if (moveForward.lengthSq() > 0) {
                    moveForward.normalize();
                }
                viewer.cameraManager.camera.position.add(moveForward.mulScalar(2));
                viewer.cameraManager.camera.position.y = Math.max(viewer.cameraManager.camera.position.y, 1.6);
                
                const activeControllerTeleport = viewer.cameraManager.getController(state.cameraMode) as any;
                if (activeControllerTeleport && typeof activeControllerTeleport.goto === 'function') {
                    activeControllerTeleport.goto(viewer.cameraManager.camera);
                }

                camera.setPosition(viewer.cameraManager.camera.position);
                app.renderNextFrame = true;
                emitCameraUpdate(global);
                break;
            case 'SET_PERFORMANCE_MODE':
                state.performanceMode = command.enabled;
                app.renderNextFrame = true;
                break;
            case 'PLAY_ANIM':
                if (state.hasAnimation) {
                    state.cameraMode = 'anim';
                    state.animationPaused = false;
                    app.renderNextFrame = true;
                }
                break;
            case 'PAUSE_ANIM':
                if (state.hasAnimation) {
                    state.animationPaused = true;
                    app.renderNextFrame = true;
                }
                break;
            case 'SET_TIME_OF_DAY':
            case 'UPDATE_SETTINGS':
            case 'BEGIN_MEASUREMENT':
            case 'END_MEASUREMENT':
                events.fire('splattour:command', command);
                app.renderNextFrame = true;
                break;
        }
    };

    window.addEventListener('message', handleMessage);

    let lastCameraEvent = 0;
    app.on('update', () => {
        const now = performance.now();
        if (now - lastCameraEvent < 120) {
            return;
        }
        lastCameraEvent = now;
        emitCameraUpdate(global);
    });
};

const emitViewerProgress = (value: number) => {
    postToParent({ type: 'PROGRESS', value });
};

const emitViewerFirstFrame = () => {
    postToParent({ type: 'FIRST_FRAME' });
};

export { emitViewerFirstFrame, emitViewerProgress, initPostMessageBridge };
