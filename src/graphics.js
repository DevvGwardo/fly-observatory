export const graphicsMessage = 'GRAPHICS INTERRUPTED · Live data continues. Waiting for the browser to restore 3D. Refresh this viewer if needed.';

export function watchGraphics(canvas, onChange) {
  const lost = event => { event.preventDefault(); onChange(true); };
  const restored = () => onChange(false);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}
