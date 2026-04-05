// Rive instantiation config — riveInst is the global instance
// Uncomment any property to override defaults

({
  autoplay: true,
  autoBind: true,

  // artboard: "MyArtboard",
  // stateMachines: "main-sm",
  // animations: "idle",
  // canvasSize: { mode: "fixed", width: 1920, height: 1080, lockAspectRatio: true },

  // layout: { fit: "contain", alignment: "center" },
  //   fit options: contain, cover, fill, fitWidth, fitHeight, scaleDown, none, layout
  //   alignment: center, topLeft, topCenter, topRight, etc.
  // useOffscreenRenderer: true, // recommended for transparent overlays with glows/shadows

  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  },

  // onStateChange: (event) => { console.log("state:", event); },
  // onAdvance: (event) => { console.log("advance:", event); },
  // onPlay: () => { console.log("play"); },
  // onPause: () => { console.log("pause"); },
  // onStop: () => { console.log("stop"); },
  // onLoop: (event) => { console.log("loop:", event); },
})
