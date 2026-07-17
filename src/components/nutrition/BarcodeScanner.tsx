import { useCallback, useEffect, useRef, useState } from 'react';
import { Barcode, Flashlight, Keyboard, Loader2, ScanLine } from 'lucide-react';
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { Button, Input } from '@/components/shared';
import { hasValidGtinChecksum, normalizeBarcode } from '@/lib/barcodes';
import { tapHaptic } from '@/lib/haptics';

const SCAN_INTERVAL_MS = 220;
const FOOD_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? zxingReaderWasmUrl : `${prefix}${path}`,
  },
});

type ScannerState = 'idle' | 'starting' | 'scanning' | 'looking-up' | 'error';

interface BarcodeScannerProps {
  onDetected: (barcode: string) => Promise<boolean>;
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

interface TorchConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Camera access is off. Allow Camera for this site in iPhone Settings, then try again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No rear camera was found on this device.';
  }
  if (!window.isSecureContext) {
    return 'Barcode scanning needs HTTPS. Open the secure phone URL and try again.';
  }
  return error instanceof Error ? error.message : 'Could not start the camera.';
}

export function BarcodeScanner({ onDetected }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const detectingRef = useRef(false);
  const stoppedRef = useRef(true);
  const [state, setState] = useState<ScannerState>('idle');
  const [message, setMessage] = useState('Point the rear camera at a UPC or EAN food barcode.');
  const [manualBarcode, setManualBarcode] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stopCamera = useCallback(() => {
    stoppedRef.current = true;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectingRef.current = false;
    setTorchAvailable(false);
    setTorchOn(false);
  }, []);

  const resolveBarcode = useCallback(async (rawValue: string) => {
    const barcode = normalizeBarcode(rawValue);
    if (!hasValidGtinChecksum(barcode)) {
      setState('error');
      setMessage('That barcode is incomplete or failed its checksum. Try again or enter the digits below.');
      return;
    }

    stopCamera();
    tapHaptic();
    setState('looking-up');
    setMessage(`Looking up ${barcode}…`);

    try {
      const found = await onDetected(barcode);
      if (!found) {
        setState('error');
        setMessage('No exact food match was found. Try USDA search or add it manually.');
      }
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Food lookup failed. Try again.');
    }
  }, [onDetected, stopCamera]);

  const scanFrame = useCallback(() => {
    let lastScanAt = 0;

    const tick = async (timestamp: number) => {
      if (stoppedRef.current) return;

      const video = videoRef.current;
      const detector = detectorRef.current;
      if (
        video
        && detector
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !detectingRef.current
        && timestamp - lastScanAt >= SCAN_INTERVAL_MS
      ) {
        lastScanAt = timestamp;
        detectingRef.current = true;
        try {
          const results = await detector.detect(video);
          const result = results.find((candidate) => hasValidGtinChecksum(candidate.rawValue));
          if (result && !stoppedRef.current) {
            void resolveBarcode(result.rawValue);
            return;
          }
        } catch {
          // Empty frames and partial reads are expected while the camera is moving.
        } finally {
          detectingRef.current = false;
        }
      }

      if (!stoppedRef.current) frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [resolveBarcode]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setState('starting');
    setMessage('Starting rear camera…');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support camera scanning.');
      }

      detectorRef.current = new BarcodeDetector({ formats: [...FOOD_BARCODE_FORMATS] });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Camera preview is unavailable.');
      }

      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined;
      setTorchAvailable(capabilities?.torch === true);
      stoppedRef.current = false;
      setState('scanning');
      setMessage('Hold the barcode inside the frame. Move closer until the bars are sharp.');
      scanFrame();
    } catch (error) {
      stopCamera();
      setState('error');
      setMessage(cameraErrorMessage(error));
    }
  }, [scanFrame, stopCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  useEffect(() => stopCamera, [stopCamera]);

  const busy = state === 'starting' || state === 'looking-up';
  const scanning = state === 'scanning';

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden bg-black aspect-[4/3] hairline-strong">
        <video ref={videoRef} muted playsInline className={`w-full h-full object-cover ${scanning ? 'opacity-100' : 'opacity-35'}`} />
        <div className="absolute inset-[18%_10%] border border-white/80" aria-hidden="true">
          <span className="absolute left-1/2 top-1/2 w-[82%] h-px -translate-x-1/2 bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]" />
        </div>
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center">
            {busy ? <Loader2 className="w-7 h-7 animate-spin text-white" /> : <Barcode className="w-8 h-8 text-white/75" strokeWidth={1.5} />}
          </div>
        )}
        {torchAvailable && scanning && (
          <button
            type="button"
            onClick={() => { void toggleTorch(); }}
            className="pressable absolute top-3 right-3 flex items-center justify-center w-10 h-10 bg-black/65 text-white"
            aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
          >
            <Flashlight className="w-4 h-4" fill={torchOn ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      <p className={`t-caption ${state === 'error' ? 'text-[var(--color-accent)]' : ''}`} aria-live="polite">
        {message}
      </p>

      {!scanning ? (
        <Button className="w-full" size="lg" onClick={() => { void startCamera(); }} loading={state === 'starting'} disabled={busy}>
          <ScanLine className="w-4 h-4" />
          {state === 'error' ? 'Scan again' : 'Start scanner'}
        </Button>
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => { stopCamera(); setState('idle'); }}>
          Stop camera
        </Button>
      )}

      <button
        type="button"
        className="pressable flex items-center gap-2 t-label text-[var(--color-text-dim)]"
        onClick={() => setShowManual((current) => !current)}
      >
        <Keyboard className="w-4 h-4" strokeWidth={1.5} />
        Enter barcode digits
      </button>

      {showManual && (
        <div className="space-y-3">
          <Input
            label="UPC / EAN"
            inputMode="numeric"
            autoComplete="off"
            value={manualBarcode}
            onChange={(event) => setManualBarcode(normalizeBarcode(event.target.value).slice(0, 14))}
            placeholder="8, 12, 13, or 14 digits"
          />
          <Button
            variant="secondary"
            className="w-full"
            disabled={!hasValidGtinChecksum(manualBarcode) || busy}
            onClick={() => { void resolveBarcode(manualBarcode); }}
          >
            Look up barcode
          </Button>
        </div>
      )}
    </div>
  );
}
