// Rive instantiation config — riveInst is the global instance
// Uncomment any property to override defaults

{
  autoplay: true,
  autoBind: true,

  // artboard: "MyArtboard",
  // stateMachine: "main-sm", // RAV also adapts this for runtimes older than 2.41
  // animations: "idle", // compatibility option for timeline-only files
  // canvasSize: { mode: "fixed", width: 1920, height: 1080, lockAspectRatio: true },

  // layout: { fit: "contain", alignment: "center" },
  //   fit options: contain, cover, fill, fitWidth, fitHeight, scaleDown, none, layout
  //   alignment: center, topLeft, topCenter, topRight, etc.
  // useOffscreenRenderer: true, // optional for transparent canvas backgrounds with glows/shadows

  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();
  },

  // onAdvance: (event) => { console.log("advance:", event); },
  // onPlay: () => { console.log("play"); },
  // onPause: () => { console.log("pause"); },
  // onStop: () => { console.log("stop"); },
}
