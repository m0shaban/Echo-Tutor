import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// Global variables
let currentVrm = null;
let isSpeaking = false;
let currentEmotion = 'neutral';

function initVRM() {
  const container = document.getElementById('avatar-container');
  const orb = document.getElementById('avatar-orb');

  if (!container) return;

  // Hide the old CSS orb
  if (orb) {
    orb.style.display = 'none';
  }

  const scene = new THREE.Scene();

  // Camera
  const camera = new THREE.PerspectiveCamera(30.0, container.clientWidth / container.clientHeight, 0.1, 20.0);
  camera.position.set(0.0, 1.4, 1.5); // Focus on the face

  // Renderer
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  // Make the canvas fit the container
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.zIndex = '10';
  container.appendChild(renderer.domElement);

  // Light
  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(1.0, 1.0, 1.0).normalize();
  scene.add(light);

  // Load VRM
  const loader = new GLTFLoader();
  loader.crossOrigin = 'anonymous';

  loader.register((parser) => {
    return new VRMLoaderPlugin(parser);
  });

  // Using a sample VRM model from three-vrm examples
  const vrmUrl = 'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@main/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

  loader.load(
    vrmUrl,
    (gltf) => {
      const vrm = gltf.userData.vrm;
      
      // Disable frustum culling
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      
      scene.add(vrm.scene);
      currentVrm = vrm;
      
      // Rotate model to face camera
      vrm.scene.rotation.y = Math.PI;
      
      console.log('VRM loaded successfully');
    },
    (progress) => console.log('Loading model...', 100.0 * (progress.loaded / progress.total), '%'),
    (error) => console.error('Error loading VRM:', error)
  );

  // Animation Loop
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = clock.getDelta();
    
    if (currentVrm) {
      // Update VRM components
      currentVrm.update(deltaTime);
      
      // Handle Lip Sync (Fake 3D Lip Sync)
      if (isSpeaking) {
        // Randomly open and close mouth to simulate talking
        const mouthOpen = Math.random() * 0.8 + 0.2; // Random value between 0.2 and 1.0
        currentVrm.expressionManager.setValue('aa', mouthOpen);
      } else {
        // Close mouth when not speaking
        currentVrm.expressionManager.setValue('aa', 0);
      }
      
      // Handle Emotions (Blinking, etc.)
      // Add a simple blink every few seconds
      const time = clock.getElapsedTime();
      if (Math.sin(time * 2) > 0.95) {
        currentVrm.expressionManager.setValue('blink', 1);
      } else {
        currentVrm.expressionManager.setValue('blink', 0);
      }
    }
    
    renderer.render(scene, camera);
  }

  animate();

  // Handle window resize
  window.addEventListener('resize', () => {
    if (!container) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVRM);
} else {
  initVRM();
}

// Expose functions to global scope so script.js can call them
window.setVRMLipSync = function(speaking) {
  isSpeaking = speaking;
};

window.setVRMEmotion = function(emotion) {
  currentEmotion = emotion;
  if (currentVrm) {
    // Reset all expressions
    ['neutral', 'happy', 'angry', 'sad', 'relaxed'].forEach(exp => {
      currentVrm.expressionManager.setValue(exp, 0);
    });
    
    // Set new expression if valid
    if (['neutral', 'happy', 'angry', 'sad', 'relaxed'].includes(emotion)) {
      currentVrm.expressionManager.setValue(emotion, 1);
    }
  }
};
