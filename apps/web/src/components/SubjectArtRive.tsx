import { Fit, Layout, RuntimeLoader, useRive } from "@rive-app/react-webgl2";
import wasmFallbackUrl from "@rive-app/webgl2/rive_fallback.wasm?url";
import wasmUrl from "@rive-app/webgl2/rive.wasm?url";
import { useEffect, useState } from "react";

// The runtime's WebAssembly is served from this app, never from a public CDN.
RuntimeLoader.setWasmUrl(wasmUrl);
RuntimeLoader.setWasmFallbackUrl(wasmFallbackUrl);

/** One download of the .riv per page, shared by every card that shows subject art. */
const files = new Map<string, Promise<ArrayBuffer>>();
function load(src: string) {
  let file = files.get(src);
  if (!file) {
    file = fetch(src).then((r) => {
      if (!r.ok) throw new Error(`Rive file ${src} answered ${r.status}`);
      return r.arrayBuffer();
    });
    file.catch(() => files.delete(src));
    files.set(src, file);
  }
  return file;
}

const LAYOUT = new Layout({ fit: Fit.Contain });

/**
 * One artboard of a .riv, playing its `main` state machine. Loaded lazily by `SubjectArt`, which keeps
 * the SVG on screen until `onReady` and for good after `onError`.
 */
export default function SubjectArtRive({
  src,
  artboard,
  onReady,
  onError,
}: {
  src: string;
  artboard: string;
  onReady: () => void;
  onError: () => void;
}) {
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let live = true;
    load(src).then(
      (b) => live && setBuffer(b),
      () => live && onError(),
    );
    return () => {
      live = false;
    };
    // onError is a state setter upstream; the file is what this effect follows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const { RiveComponent } = useRive(
    buffer
      ? {
          buffer,
          artboard,
          stateMachine: "main",
          autoplay: true,
          layout: LAYOUT,
          enableRiveAssetCDN: false,
          // the scenes listen for the pointer (hover); a finger dragging across one must still scroll the page
          isTouchScrollEnabled: true,
          onLoad: onReady,
          onLoadError: onError,
        }
      : null,
  );

  return <RiveComponent aria-hidden />;
}
