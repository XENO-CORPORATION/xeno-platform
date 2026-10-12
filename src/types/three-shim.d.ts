// three ships no types of its own and @types/three is not installed. Only StudioModelStage uses it, behind
// a lazy import; these declarations keep that one file compiling. Replace with @types/three when it is added.
declare module 'three';
declare module 'three/examples/jsm/controls/OrbitControls.js';
declare module 'three/examples/jsm/loaders/GLTFLoader.js';
declare module 'three/examples/jsm/environments/RoomEnvironment.js';
