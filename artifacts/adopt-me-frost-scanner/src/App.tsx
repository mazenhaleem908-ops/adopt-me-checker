import { type ChangeEvent, type ReactNode, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAnalyzeScannerMedia, useGetValueStatus, getGetValueStatusQueryKey, useLookupScannerValue, type PetDetection, type ScanResult } from '@workspace/api-client-react';
import { AlertTriangle, Check, ChevronDown, CircleHelp, FileImage, Film, Gauge, Info, RotateCcw, ScanLine, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();

type Correction = Pick<PetDetection, 'petName' | 'variant' | 'potion'>;
type MediaKind = 'image' | 'video';

const ALL_MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,video/x-m4v';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const MAX_VIDEO_DIMENSION = 1280;

function formatValue(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function percent(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function mediaKindFor(file: File): MediaKind | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(name)) return 'video';
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || /\.(png|jpe?g|webp)$/i.test(name)) return 'image';
  return null;
}

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('This browser cannot prepare the image.'));
          return;
        }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => reject(new Error('This image format is not supported. Use PNG, JPG, or WEBP.'));
      image.src = String(reader.result);
    };
    reader.onabort = () => reject(new Error('Reading the image was cancelled.'));
    reader.onerror = () => reject(new Error('Could not read this image.'));
    reader.readAsDataURL(file);
  });
}

async function readVideoFrames(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('The video took too long to open. Try a shorter MP4 or WEBM file.')), 10000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not read this video. Use MP4 or WEBM.'));
      };
      video.load();
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth || !video.videoHeight) {
      throw new Error('This video has no readable frames. Try a normal MP4 or WEBM video.');
    }

    const frameCount = Math.min(6, Math.max(1, Math.ceil(duration / 2)));
    const scale = Math.min(1, MAX_VIDEO_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare video frames.');

    const frames: string[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      const targetTime = Math.min(duration - 0.05, (duration * (index + 0.5)) / frameCount);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          video.onseeked = null;
          resolve();
        };
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          video.onseeked = null;
          reject(new Error('Could not seek through this video. Try a shorter MP4 or WEBM file.'));
        }, 5000);
        video.onseeked = finish;
        video.currentTime = targetTime;
        if (Math.abs(video.currentTime - targetTime) < 0.01) {
          window.requestAnimationFrame(finish);
        }
      });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.76));
    }
    return frames;
  } finally {
    video.onloadedmetadata = null;
    video.onseeked = null;
    video.onerror = null;
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function messageForError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  const apiMessage = error.message.match(/:\s*(?:The|Upload|Vision|HTTP).*/)?.[0]?.replace(/^:\s*/, '');
  return apiMessage || error.message;
}

function BrandMark() {
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/35 bg-primary/10 text-primary shadow-[0_0_25px_rgba(141,236,255,.12)]" aria-hidden="true">
      <ScanLine size={21} strokeWidth={1.7} />
      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
    </div>
  );
}

function StatusPill({ available, provider }: { available: boolean; provider: string }) {
  return (
    <div data-testid="status-value-catalog" className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${available ? 'border-emerald-300/20 bg-emerald-300/8 text-emerald-200' : 'border-accent/25 bg-accent/8 text-accent'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${available ? 'bg-emerald-300' : 'bg-accent'}`} />
      <span>{available ? 'Verified catalog online' : 'Value catalog unavailable'}</span>
      <span className="text-foreground/45">·</span>
      <span className="font-mono text-[10px] uppercase tracking-wider">{provider || 'provider pending'}</span>
    </div>
  );
}

function UploadZone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [accept, setAccept] = useState(ALL_MEDIA_ACCEPT);

  const choose = (nextAccept = accept) => {
    setAccept(nextAccept);
    window.setTimeout(() => inputRef.current?.click(), 0);
  };
  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = '';
    setAccept(ALL_MEDIA_ACCEPT);
  };

  return (
    <div
      data-testid="upload-zone"
      role="button"
      tabIndex={0}
      onClick={() => choose()}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') choose(); }}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={`group relative flex min-h-[310px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-8 text-center transition-all ${dragging ? 'border-primary bg-primary/10' : 'border-primary/25 bg-[#111d32]/80 hover:border-primary/60 hover:bg-primary/5'} ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
       <input ref={inputRef} data-testid="input-media-upload" className="hidden" type="file" accept={accept} onChange={handleInput} />
      <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_50%_15%,rgba(155,239,255,.13),transparent_38%)]" />
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary transition-transform group-hover:-translate-y-1">
        <Upload size={27} strokeWidth={1.5} />
      </div>
      <p className="relative text-lg font-semibold text-foreground">Drop an inventory screenshot here</p>
      <p className="relative mt-2 max-w-[290px] text-sm leading-6 text-muted-foreground">Choose a source or drop media here. Frames stay focused on the scan.</p>
      <div className="relative mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" data-testid="button-upload-image" onClick={(event) => { event.stopPropagation(); choose('image/png,image/jpeg,image/webp'); }} className="flex items-center gap-2 rounded-lg border border-primary/35 bg-primary/10 px-3.5 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20">
          <FileImage size={15} /> Upload image
        </button>
        <button type="button" data-testid="button-upload-video" onClick={(event) => { event.stopPropagation(); choose('video/mp4,video/webm'); }} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3.5 py-2.5 text-xs font-semibold text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary">
          <Film size={15} /> Upload video
        </button>
      </div>
       <div className="relative mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-foreground/40">
         <FileImage size={13} /> PNG / JPG / WEBP <span className="text-foreground/20">·</span> <Film size={13} /> MP4 / WEBM
      </div>
    </div>
  );
}

function StepRail({ active }: { active: 1 | 2 | 3 }) {
  const steps = ['Upload', 'Analyze', 'Readout'];
  return (
    <div data-testid="scan-step-rail" className="mb-8 flex items-center">
      {steps.map((step, index) => {
        const number = index + 1;
        const complete = number < active;
        const current = number === active;
        return (
          <div className="flex flex-1 items-center" key={step}>
            <div className={`flex items-center gap-2 text-xs font-medium ${current ? 'text-primary' : complete ? 'text-foreground/70' : 'text-foreground/35'}`}>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[11px] ${current ? 'border-primary bg-primary text-primary-foreground' : complete ? 'border-primary/50 bg-primary/10 text-primary' : 'border-foreground/15 bg-secondary/50'}`}>
                {complete ? <Check size={13} /> : `0${number}`}
              </span>
              <span className="hidden sm:inline">{step}</span>
            </div>
            {index < 2 && <div className={`mx-3 h-px flex-1 ${number < active ? 'bg-primary/50' : 'bg-foreground/10'}`} />}
          </div>
        );
      })}
    </div>
  );
}

function CorrectionRow({ detection, correction, onChange }: { detection: PetDetection; correction?: Correction; onChange: (value: Correction) => void }) {
  const value = correction ?? { petName: detection.petName, variant: detection.variant, potion: detection.potion };
  return (
    <div data-testid={`card-detection-${detection.id}`} className="rounded-xl border border-accent/25 bg-accent/[0.045] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.16em] text-accent"><AlertTriangle size={13} /> Confirmation needed</div>
          <p className="text-sm text-foreground/75">The scanner found a low-confidence match. Correct the read before using it.</p>
        </div>
        <span className="shrink-0 rounded-md bg-accent/10 px-2 py-1 font-mono text-xs text-accent">{percent(detection.confidence)}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr]">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-foreground/40">Pet name</span>
          <input data-testid={`input-pet-name-${detection.id}`} value={value.petName} onChange={(event) => onChange({ ...value, petName: event.target.value })} className="h-10 w-full rounded-lg border border-border bg-background/70 px-3 text-sm outline-none transition-colors focus:border-primary" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-foreground/40">Variant</span>
          <select data-testid={`select-variant-${detection.id}`} value={value.variant} onChange={(event) => onChange({ ...value, variant: event.target.value as Correction['variant'] })} className="h-10 w-full appearance-none rounded-lg border border-border bg-background/70 px-3 text-sm outline-none focus:border-primary">
            <option>Normal</option><option>Neon</option><option>Mega Neon</option><option>Unknown</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-foreground/40">Potion</span>
          <select data-testid={`select-potion-${detection.id}`} value={value.potion} onChange={(event) => onChange({ ...value, potion: event.target.value as Correction['potion'] })} className="h-10 w-full appearance-none rounded-lg border border-border bg-background/70 px-3 text-sm outline-none focus:border-primary">
            <option>None</option><option>Fly</option><option>Ride</option><option>Fly Ride</option><option>Unknown</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function DetectionCard({ detection, correction }: { detection: PetDetection; correction?: Correction }) {
  const display = correction ?? detection;
  const state = detection.valueStatus;
  return (
    <div data-testid={`row-detection-${detection.id}`} className="group flex items-center gap-3 border-b border-border/70 py-4 last:border-0">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/8 text-primary"><Sparkles size={17} /></div>
      <div className="min-w-0 flex-1">
        <p data-testid={`text-pet-name-${detection.id}`} className="truncate text-sm font-semibold">{display.petName || 'Unnamed detection'}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{display.variant} <span className="text-foreground/20">/</span> {display.potion} {detection.evidenceFrame !== null && <span className="ml-1 font-mono text-[10px] text-foreground/35">frame {detection.evidenceFrame + 1}</span>}</p>
      </div>
      <div className="text-right">
        <p data-testid={`text-detection-value-${detection.id}`} className={`font-mono text-sm ${state === 'verified' ? 'text-primary' : 'text-foreground/45'}`}>{state === 'verified' ? `${formatValue(detection.frostValue)} FV` : 'Unavailable'}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-foreground/35">{percent(detection.confidence)} match</p>
      </div>
    </div>
  );
}

function ScanApp() {
  const valueStatus = useGetValueStatus({ query: { queryKey: getGetValueStatusQueryKey() } });
  const analyze = useAnalyzeScannerMedia();
  const lookup = useLookupScannerValue();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [fileError, setFileError] = useState('');
  const [corrections, setCorrections] = useState<Record<string, Correction>>({});
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const catalog = valueStatus.data;
  const isWorking = isPreparing || analyze.isPending;
  const activeStep = result ? 3 : isWorking ? 2 : 1;

  const analyzeFile = async (file: File) => {
    setFileError('');
    setResult(null);
    setCorrections({});
    setSourceName(file.name);
    setIsPreparing(true);
    try {
      const mediaType = mediaKindFor(file);
      if (!mediaType) {
        throw new Error('Unsupported file type. Choose PNG, JPG, WEBP, MP4, or WEBM.');
      }
      const maxBytes = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (file.size > maxBytes) {
        throw new Error(`This ${mediaType} is too large. Keep it under ${mediaType === 'video' ? '200MB' : '20MB'} and try again.`);
      }
      const frames = mediaType === 'video' ? await readVideoFrames(file) : [await readImage(file)];
      setIsPreparing(false);
      analyze.mutate({ data: { mediaType, frames, sourceName: file.name } }, {
        onSuccess: (scan) => setResult(scan),
        onError: (error) => setFileError(messageForError(error, 'The scan could not be completed. Check the file and try again.')),
      });
    } catch (error) {
      setIsPreparing(false);
      setFileError(messageForError(error, 'This file could not be prepared.'));
    }
  };

  const reset = () => {
    setResult(null);
    setSourceName('');
    setFileError('');
    setCorrections({});
    setIsRecalculating(false);
  };

  const applyCorrections = async () => {
    if (!result) return;
    setIsRecalculating(true);
    setFileError('');
    try {
      const detections = await Promise.all(
        result.detections.map(async (detection) => {
          const correction = corrections[detection.id];
          if (!correction) return detection;
          const value = await lookup.mutateAsync({ data: correction });
          return {
            ...detection,
            petName: correction.petName,
            variant: correction.variant,
            potion: correction.potion,
            frostValue: value.frostValue,
            valueStatus: value.valueStatus,
            needsConfirmation: value.valueStatus !== 'verified',
          };
        }),
      );
      const totalFrostValue =
        detections.length > 0 && detections.every((detection) => detection.valueStatus === 'verified')
          ? detections.reduce((total, detection) => total + (detection.frostValue ?? 0), 0)
          : null;
      setResult({ ...result, detections, totalFrostValue });
      setCorrections({});
    } catch {
      setFileError('A corrected pet could not be matched against the verified catalog.');
    } finally {
      setIsRecalculating(false);
    }
  };

  return (
    <main className="frost-noise min-h-[100dvh] overflow-hidden bg-background">
      <div className="technical-grid min-h-[100dvh]">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-sm font-bold tracking-tight">FROST<span className="text-primary">SCAN</span></p>
              <p className="font-mono text-[9px] uppercase tracking-[.2em] text-foreground/40">Adopt Me value reader</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill available={Boolean(catalog?.available)} provider={catalog?.provider ?? 'checking'} />
            <div data-testid="text-build-label" className="hidden font-mono text-[10px] uppercase tracking-[.14em] text-foreground/30 md:block">v1.0 / focused mode</div>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 lg:pt-16">
          <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-20">
            <div>
              <div className="mb-8 max-w-2xl">
                <div className="mb-5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary/75"><Gauge size={14} /> Precision scanner / ready</div>
                <h1 className="text-5xl font-extrabold leading-[.96] tracking-[-.055em] text-foreground sm:text-7xl">Know the<br /><span className="text-primary">Frost Value.</span></h1>
                <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">Drop in an inventory or trade screenshot. FrostScan identifies what is actually visible, then checks each match against the verified value catalog.</p>
              </div>
              <StepRail active={activeStep as 1 | 2 | 3} />

              {fileError && (
                <div data-testid="status-scan-error" className="mb-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive-foreground">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
                  <div className="flex-1"><p className="font-semibold">Scan interrupted</p><p className="mt-1 text-foreground/60">{fileError}</p></div>
                  <button data-testid="button-dismiss-error" onClick={() => setFileError('')} className="text-foreground/40 hover:text-foreground"><X size={16} /></button>
                </div>
              )}

              {!result && !isWorking && <UploadZone onFile={analyzeFile} disabled={isWorking} />}

              {isWorking && (
                <div data-testid="status-scan-loading" className="rounded-2xl border border-primary/20 bg-[#111d32]/90 p-7">
                  <div className="mb-7 flex items-center justify-between">
                    <div><p className="text-lg font-semibold">{isPreparing ? 'Preparing scan frames' : 'Analyzing visible pets'}</p><p className="mt-1 text-sm text-muted-foreground">{sourceName || 'Uploaded media'} <span className="text-foreground/25">·</span> no assumptions, only evidence</p></div>
                    <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 text-primary"><ScanLine size={20} className="animate-pulse" /></div>
                  </div>
                  <div className="space-y-3">
                    <div className="skeleton h-3 w-[82%] rounded-full" />
                    <div className="skeleton h-3 w-[64%] rounded-full" />
                    <div className="skeleton h-3 w-[46%] rounded-full" />
                  </div>
                  <div className="mt-8 flex items-center gap-3 border-t border-border/60 pt-5 font-mono text-[10px] uppercase tracking-[.15em] text-primary/70"><span className="h-1.5 w-1.5 animate-scan-pulse rounded-full bg-primary" /> Reading evidence frames</div>
                </div>
              )}

              {result && (
                <div className="animate-reveal space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[.045] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{result.sourceName?.toLowerCase().endsWith('.mp4') ? <Film size={15} /> : <FileImage size={15} />}</div><p className="truncate text-sm">{result.sourceName || sourceName}</p></div>
                    <button data-testid="button-new-scan" onClick={reset} className="flex items-center gap-2 text-xs font-semibold text-primary transition-colors hover:text-foreground"><RotateCcw size={14} /> New scan</button>
                  </div>
                  <div className="rounded-2xl border border-border bg-card/80 p-5 sm:p-6">
                    <div className="mb-2 flex items-center justify-between"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-foreground/45">Detected from evidence</p><span data-testid="text-analyzed-frames" className="font-mono text-[10px] text-foreground/40">{result.analyzedFrames} frame{result.analyzedFrames === 1 ? '' : 's'} checked</span></div>
                    {result.detections.length === 0 ? (
                      <div data-testid="status-no-detections" className="flex items-start gap-3 border-t border-border/60 py-7 text-sm text-muted-foreground"><Info className="mt-0.5 shrink-0 text-primary" size={18} /><div><p className="font-semibold text-foreground">No pets were confidently detected</p><p className="mt-1 leading-6">Try a clearer screenshot with the full inventory or trade window visible.</p></div></div>
                    ) : (
                      <div>{result.detections.map((detection) => <DetectionCard key={detection.id} detection={detection} correction={corrections[detection.id]} />)}</div>
                    )}
                  </div>
                  {result.detections.filter((detection) => detection.needsConfirmation).length > 0 && (
                    <div className="space-y-3">
                      {result.detections.filter((detection) => detection.needsConfirmation).map((detection) => (
                        <CorrectionRow key={detection.id} detection={detection} correction={corrections[detection.id]} onChange={(value) => setCorrections((current) => ({ ...current, [detection.id]: value }))} />
                      ))}
                      <button type="button" data-testid="button-apply-corrections" disabled={isRecalculating || Object.keys(corrections).length === 0} onClick={applyCorrections} className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-45">
                        {isRecalculating ? <ScanLine size={16} className="animate-pulse" /> : <Check size={16} />}
                        {isRecalculating ? 'Checking corrected values…' : 'Apply corrections & recalculate'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <aside className="lg:pt-[122px]">
              <div className={`relative overflow-hidden rounded-2xl border p-6 ${result?.valueDataAvailable ? 'border-primary/30 bg-primary/[.07]' : 'border-border bg-card/65'}`}>
                <div className="absolute -right-5 -top-8 h-32 w-32 rotate-45 border border-primary/10 bg-primary/[.025] animate-float-crystal" />
                <div className="relative">
                  <div className="mb-9 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.2em] text-foreground/45">Frost readout</span><ShieldCheck size={17} className={result?.valueDataAvailable ? 'text-primary' : 'text-foreground/25'} /></div>
                  <p className="font-mono text-[10px] uppercase tracking-[.16em] text-foreground/35">Verified total</p>
                  <div data-testid="text-total-frost-value" className="mt-2 flex items-baseline gap-2"><span className={`text-5xl font-extrabold tracking-[-.06em] ${result?.valueDataAvailable ? 'text-primary' : 'text-foreground/25'}`}>{result ? formatValue(result.totalFrostValue) : '—'}</span>{result?.totalFrostValue !== null && <span className="font-mono text-xs text-primary/65">FV</span>}</div>
                  <div className="my-6 h-px bg-border/80" />
                  {result ? (
                    result.valueDataAvailable ? <p data-testid="status-value-available" className="text-sm leading-6 text-foreground/70">Verified against <span className="text-primary">{result.valueProvider}</span>. Review any flagged detections before trading.</p> : <p data-testid="status-value-unavailable" className="text-sm leading-6 text-accent/80">The scanner found the pets, but verified value data is unavailable right now. No estimate is shown.</p>
                  ) : <p className="text-sm leading-6 text-muted-foreground">Your total appears here after the scan. FrostScan never fills gaps with an estimate.</p>}
                  <div className="mt-6 flex items-center justify-between text-[10px] uppercase tracking-wider text-foreground/35"><span>{catalog?.entryCount ? `${catalog.entryCount.toLocaleString()} catalog entries` : 'Catalog status pending'}</span><CircleHelp size={14} /></div>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-border/70 bg-card/35 p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[.16em] text-foreground/55">How to get a clean read</p>
                <ul className="space-y-3 text-xs leading-5 text-muted-foreground">
                  <li className="flex gap-2"><span className="font-mono text-primary">01</span> Show the full pet card, including variant and potion icons.</li>
                  <li className="flex gap-2"><span className="font-mono text-primary">02</span> Keep trade slots or inventory tiles large and unobstructed.</li>
                  <li className="flex gap-2"><span className="font-mono text-primary">03</span> Confirm any amber-marked match before you trade.</li>
                </ul>
              </div>
            </aside>
          </div>
        </section>
        <footer className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-border/60 px-5 py-6 text-[10px] uppercase tracking-[.15em] text-foreground/30 sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>FrostScan / evidence first</span><span>Values depend on the verified catalog status</span></footer>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={ScanApp} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;