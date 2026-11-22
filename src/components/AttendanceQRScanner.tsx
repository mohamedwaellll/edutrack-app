import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import { 
  Camera, 
  CameraOff, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  RefreshCw, 
  Clock, 
  UserCheck, 
  FileImage,
  ArrowRight
} from 'lucide-react';
import { attendanceService, QRAttendanceResult } from '../services/attendanceService';
import { GroupClass } from '../types/database';
import { useOptionalAuth } from '../contexts/AuthContext';

interface AttendanceQRScannerProps {
  classesList: GroupClass[];
  selectedGroupId: string;
  onSelectGroupId: (groupId: string) => void;
  onAttendanceRecorded?: () => void;
  mutationsDisabled?: boolean;
}

interface ScanFeedItem {
  id: string;
  studentName: string;
  studentCode: string;
  status: string;
  time: string;
  resultCode: string;
  isSuccess: boolean;
  message: string;
}

export const AttendanceQRScanner: React.FC<AttendanceQRScannerProps> = ({
  classesList,
  selectedGroupId,
  onSelectGroupId,
  onAttendanceRecorded,
  mutationsDisabled = false,
}) => {
  const auth = useOptionalAuth();
  const isSessionRevalidating = Boolean(mutationsDisabled || auth?.isRevalidating);
  const isSessionRevalidatingRef = useRef(isSessionRevalidating);
  isSessionRevalidatingRef.current = isSessionRevalidating;

  // Mode: camera vs image upload vs manual token
  const [scanMode, setScanMode] = useState<'camera' | 'upload' | 'manual'>('camera');
  
  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Guard against late-arriving media streams after mode switch, stop, or unmount
  const cameraRequestedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  // Scan execution state
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<{
    success: boolean;
    code: string;
    message: string;
    studentName?: string;
    studentCode?: string;
    checkInTime?: string;
    status?: string;
  } | null>(null);

  // Scan cooldown & duplicate prevention
  const lastScannedTokenRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const isExecutingRef = useRef<boolean>(false);

  // Recent scans feed in this session
  const [recentScans, setRecentScans] = useState<ScanFeedItem[]>([]);

  // Manual token input state (fallback/test)
  const [manualToken, setManualToken] = useState('');

  // Stop camera function - immediately cleans up and revokes requested flag
  const stopCamera = useCallback(() => {
    cameraRequestedRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  // Cleanup camera when unmounting or switching scan mode
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (scanMode !== 'camera' && (isCameraActive || cameraRequestedRef.current)) {
      stopCamera();
    }
  }, [scanMode, isCameraActive, stopCamera]);

  // Handle core scan submission
  const processQRCode = useCallback(
    async (rawCode: string) => {
      if (isSessionRevalidatingRef.current) {
        setLastScanResult({
          success: false,
          code: 'REVALIDATING',
          message: 'Verifying session permissions. Scan was paused and not recorded — try again once confirmed.',
        });
        return;
      }

      const token = rawCode.trim();
      if (!token) return;

      const now = Date.now();
      // Debounce: ignore same token within 3 seconds
      if (lastScannedTokenRef.current === token && now - lastScannedTimeRef.current < 3000) {
        return;
      }

      if (isExecutingRef.current) return;
      isExecutingRef.current = true;
      setIsProcessing(true);
      lastScannedTokenRef.current = token;
      lastScannedTimeRef.current = now;

      try {
        const res = await attendanceService.recordQRAttendance(token, selectedGroupId || null);

        if (res.error) {
          setLastScanResult({
            success: false,
            code: 'ERROR',
            message: res.error,
          });
        } else if (res.data) {
          const outcome: QRAttendanceResult = res.data;
          const att = outcome.attendance;

          setLastScanResult({
            success: outcome.success,
            code: outcome.code,
            message: outcome.message,
            studentName: (att as any)?.student_name,
            studentCode: (att as any)?.student_code,
            checkInTime: att?.check_in_time,
            status: att?.status,
          });

          // Add to local feed
          const feedEntry: ScanFeedItem = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            studentName: (att as any)?.student_name || 'Student',
            studentCode: (att as any)?.student_code || token.slice(0, 10),
            status: att?.status || (outcome.success ? 'Present' : 'Failed'),
            time: att?.check_in_time || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            resultCode: outcome.code,
            isSuccess: outcome.success,
            message: outcome.message,
          };

          setRecentScans((prev) => [feedEntry, ...prev.slice(0, 19)]);

          if (outcome.success && onAttendanceRecorded) {
            onAttendanceRecorded();
          }
        }
      } catch (err: any) {
        setLastScanResult({
          success: false,
          code: 'ERROR',
          message: err.message || 'Failed to process QR attendance',
        });
      } finally {
        setIsProcessing(false);
        isExecutingRef.current = false;
      }
    },
    [selectedGroupId, onAttendanceRecorded]
  );

  // Camera video frame scanner loop
  const tickCameraFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !isCameraActive) {
      return;
    }

    if (!isSessionRevalidatingRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data && !isSessionRevalidatingRef.current) {
          processQRCode(code.data);
        }
      }
    }

    if (isCameraActive) {
      animationFrameRef.current = requestAnimationFrame(tickCameraFrame);
    }
  }, [isCameraActive, processQRCode]);

  useEffect(() => {
    if (isCameraActive) {
      animationFrameRef.current = requestAnimationFrame(tickCameraFrame);
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isCameraActive, tickCameraFrame]);

  // Start live camera
  const startCamera = async () => {
    if (isSessionRevalidatingRef.current) {
      setCameraError('Verifying session permissions. Please wait before starting the camera.');
      return;
    }
    if (!selectedGroupId) {
      setCameraError('Please select a target class group before starting the camera.');
      return;
    }

    setCameraError(null);
    cameraRequestedRef.current = true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by this browser environment');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      // Stop late-arriving stream if stopCamera was called, mode changed, unmounted, or revalidating
      if (!cameraRequestedRef.current || !isMountedRef.current || scanMode !== 'camera' || isSessionRevalidatingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: any) {
      stopCamera();
      let msg = err.message || 'Could not access camera.';
      if (err.name === 'NotAllowedError') {
        msg = 'Camera permission was denied. Please allow camera permissions in your browser or use image upload.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No video camera was found on this device. You can upload student card images instead.';
      }
      setCameraError(msg);
    }
  };

  // Image file upload decoder
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isSessionRevalidatingRef.current) {
      setLastScanResult({
        success: false,
        code: 'REVALIDATING',
        message: 'Verifying session permissions. Image scan paused — try again once confirmed.',
      });
      e.target.value = '';
      return;
    }

    if (!selectedGroupId) {
      setLastScanResult({
        success: false,
        code: 'GROUP_REQUIRED',
        message: 'Please select a target class group before uploading a card image.',
      });
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (isSessionRevalidatingRef.current) {
        setLastScanResult({
          success: false,
          code: 'REVALIDATING',
          message: 'Verifying session permissions. Image decode ignored — upload again once confirmed.',
        });
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (isSessionRevalidatingRef.current) {
          setLastScanResult({
            success: false,
            code: 'REVALIDATING',
            message: 'Verifying session permissions. Image scan ignored — upload again once confirmed.',
          });
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (code && code.data) {
          processQRCode(code.data);
        } else {
          setLastScanResult({
            success: false,
            code: 'NOT_FOUND',
            message: 'No readable QR code found in this image. Please ensure the card is clear and well-lit.',
          });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input value so same file can be re-selected if desired
    e.target.value = '';
  };

  // Manual token submit (for quick dev/test verification)
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidatingRef.current) {
      setLastScanResult({
        success: false,
        code: 'REVALIDATING',
        message: 'Verifying session permissions. Manual scan paused — submit again once confirmed.',
      });
      return;
    }
    if (!selectedGroupId) {
      setLastScanResult({
        success: false,
        code: 'GROUP_REQUIRED',
        message: 'Please select a target class group before submitting a scan token.',
      });
      return;
    }
    if (!manualToken.trim()) return;
    processQRCode(manualToken.trim());
    setManualToken('');
  };

  return (
    <div className="space-y-6">
      {isSessionRevalidating && (
        <div
          data-testid="qr-revalidating-banner"
          role="status"
          className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
          <span className="font-semibold">
            Re-verifying session permissions... QR attendance recording is paused until confirmed.
          </span>
        </div>
      )}
      {/* Top Controls Card: Group Selection & Scan Mode */}
      <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-[#17213B]">QR Code Attendance Scanner</h3>
            <p className="text-xs text-[#7B8794]">
              Scan student card QR codes to record immediate check-in for today (Africa/Cairo)
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center bg-[#F8F7F2] p-1 rounded-2xl border border-[#E6E8E2]">
            <button
              onClick={() => setScanMode('camera')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                scanMode === 'camera'
                  ? 'bg-white text-[#174E50] shadow-xs'
                  : 'text-[#7B8794] hover:text-[#17213B]'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              Live Camera
            </button>
            <button
              onClick={() => setScanMode('upload')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                scanMode === 'upload'
                  ? 'bg-white text-[#174E50] shadow-xs'
                  : 'text-[#7B8794] hover:text-[#17213B]'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Image
            </button>
            <button
              onClick={() => setScanMode('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                scanMode === 'manual'
                  ? 'bg-white text-[#174E50] shadow-xs'
                  : 'text-[#7B8794] hover:text-[#17213B]'
              }`}
            >
              <FileImage className="w-3.5 h-3.5" />
              Token Test
            </button>
          </div>
        </div>

        {/* Group Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-bold text-[#17213B] mb-1.5">
              Target Class Group <span className="text-rose-500">*</span>
            </label>
            <select
              value={selectedGroupId}
              onChange={(e) => onSelectGroupId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] text-xs font-medium text-[#17213B] bg-white focus:outline-none focus:border-[#174E50]"
            >
              {classesList.length === 0 ? (
                <option value="">No classes available</option>
              ) : (
                classesList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.grade_level})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-end">
            <div className="w-full bg-[#D8E8DC]/40 border border-[#A8BDA6]/40 rounded-xl p-2.5 flex items-center gap-2 text-xs text-[#174E50]">
              <Clock className="w-4 h-4 shrink-0 text-[#174E50]" />
              <span>
                Server timestamp: <strong className="font-semibold">Africa/Cairo</strong> • Scans register as <strong>Present</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Scanner Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Live Scanner / Upload Interface */}
        <div className="lg:col-span-2 space-y-4">
          {/* CAMERA MODE */}
          {scanMode === 'camera' && (
            <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs flex flex-col items-center">
              <div className="relative w-full max-w-md aspect-4/3 bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center border-2 border-[#174E50]/20 shadow-inner">
                {/* Hidden canvas used for video frame extraction */}
                <canvas ref={canvasRef} className="hidden" />

                {/* Video element */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
                />

                {/* Camera Inactive placeholder */}
                {!isCameraActive && (
                  <div className="text-center p-6 text-slate-400 space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-300">
                      <Camera className="w-7 h-7" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Camera is Off</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs">
                        Click "Start Camera" to scan student badges in real-time.
                      </p>
                    </div>
                  </div>
                )}

                {/* Scanning overlay reticle when camera is active */}
                {isCameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-52 h-52 border-2 border-[#70C9DC] rounded-2xl relative animate-pulse">
                      <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-[#70C9DC]" />
                      <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-[#70C9DC]" />
                      <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-[#70C9DC]" />
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-[#70C9DC]" />
                    </div>
                  </div>
                )}

                {/* Processing badge overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center gap-2 text-white text-xs font-bold">
                    <RefreshCw className="w-4 h-4 animate-spin text-[#70C9DC]" />
                    <span>Verifying student card...</span>
                  </div>
                )}
              </div>

              {/* Camera Error Message */}
              {cameraError && (
                <div className="w-full max-w-md mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{cameraError}</span>
                </div>
              )}

              {/* Camera action buttons */}
              <div className="mt-5 flex items-center gap-3">
                {!isCameraActive ? (
                  <button
                    onClick={startCamera}
                    disabled={!selectedGroupId || isSessionRevalidating}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#174E50] text-white text-xs font-bold hover:bg-[#134042] disabled:opacity-50 disabled:cursor-not-allowed transition shadow-xs"
                  >
                    <Camera className="w-4 h-4" />
                    {selectedGroupId ? 'Start Camera' : 'Select Class Group to Scan'}
                  </button>
                ) : (
                  <button
                    onClick={stopCamera}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition shadow-xs"
                  >
                    <CameraOff className="w-4 h-4" />
                    Stop Camera
                  </button>
                )}
              </div>
            </div>
          )}

          {/* IMAGE UPLOAD MODE */}
          {scanMode === 'upload' && (
            <div className="bg-white rounded-3xl p-8 border border-[#E6E8E2] shadow-xs text-center">
              <div className="max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-[#D8E8DC]/40 border border-[#A8BDA6]/40 flex items-center justify-center mx-auto text-[#174E50]">
                  <Upload className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-[#17213B]">Upload Student ID Card Image</h4>
                  <p className="text-xs text-[#7B8794] mt-1">
                    Select a photo or screenshot of a printed student card QR code
                  </p>
                </div>

                <label
                  className={`inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#174E50] text-white text-xs font-bold hover:bg-[#134042] transition shadow-xs ${
                    !selectedGroupId || isSessionRevalidating ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Choose Image File</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={!selectedGroupId || isSessionRevalidating}
                    className="hidden"
                  />
                </label>

                <p className="text-[11px] text-[#7B8794]">
                  Supports PNG, JPG, WEBP • Automatically decoded via jsQR
                </p>
              </div>
            </div>
          )}

          {/* MANUAL TOKEN TEST MODE */}
          {scanMode === 'manual' && (
            <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs">
              <h4 className="text-sm font-bold text-[#17213B] mb-1">Direct Token Simulator</h4>
              <p className="text-xs text-[#7B8794] mb-4">
                Test attendance check-in by pasting or typing the stored student QR hash (e.g. from the cards page)
              </p>

              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste QR hash (e.g. 550e8400-... or ET-STU-001)..."
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] text-xs font-medium text-[#17213B] focus:outline-none focus:border-[#174E50]"
                />
                <button
                  type="submit"
                  disabled={!manualToken.trim() || isProcessing || isSessionRevalidating}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#174E50] text-white text-xs font-bold hover:bg-[#134042] disabled:opacity-50 transition"
                >
                  <ArrowRight className="w-4 h-4" />
                  Submit Scan
                </button>
              </form>
            </div>
          )}

          {/* LAST SCAN RESULT CARD */}
          {lastScanResult && (
            <div
              className={`p-5 rounded-2xl border transition-all ${
                lastScanResult.success
                  ? lastScanResult.code === 'ALREADY_RECORDED'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {lastScanResult.success ? (
                    lastScanResult.code === 'ALREADY_RECORDED' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    )
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-600" />
                  )}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider">
                      {lastScanResult.code === 'RECORDED' && '✓ Check-In Confirmed'}
                      {lastScanResult.code === 'ALREADY_RECORDED' && '⚠️ Already Recorded'}
                      {lastScanResult.code === 'CONFLICT_EXISTS' && '⛔ Existing Conflict'}
                      {lastScanResult.code === 'GROUP_MISMATCH' && '⛔ Group Mismatch'}
                      {lastScanResult.code === 'HISTORICAL_GROUP_MISMATCH' && '⛔ Group Conflict'}
                      {lastScanResult.code === 'GROUP_REQUIRED' && '⛔ Group Required'}
                      {lastScanResult.code === 'STUDENT_UNASSIGNED' && '⛔ Unassigned Student'}
                      {lastScanResult.code === 'INACTIVE_STUDENT' && '⛔ Inactive Student'}
                      {lastScanResult.code === 'INVALID_TOKEN' && '⛔ Invalid QR Badge'}
                      {lastScanResult.code === 'EMPTY_TOKEN' && '⛔ Empty Token'}
                      {lastScanResult.code === 'ERROR' && '⛔ Scan Error'}
                      {lastScanResult.code === 'NOT_FOUND' && '⚠️ Unreadable QR'}
                    </span>
                    {lastScanResult.checkInTime && (
                      <span className="text-xs font-mono font-bold bg-white/70 px-2 py-0.5 rounded-md">
                        {lastScanResult.checkInTime}
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-medium leading-relaxed">
                    {lastScanResult.message}
                  </p>

                  {lastScanResult.studentName && (
                    <div className="pt-2 flex items-center gap-3 text-xs font-bold">
                      <span className="flex items-center gap-1">
                        <UserCheck className="w-3.5 h-3.5" />
                        {lastScanResult.studentName}
                      </span>
                      {lastScanResult.studentCode && (
                        <span className="font-mono text-[11px] opacity-80">
                          ({lastScanResult.studentCode})
                        </span>
                      )}
                      {lastScanResult.status && (
                        <span className="px-2 py-0.5 rounded bg-white/80 text-[10px] uppercase font-bold">
                          {lastScanResult.status}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Live Session Scan Feed */}
        <div className="bg-white rounded-3xl p-6 border border-[#E6E8E2] shadow-xs flex flex-col h-[520px]">
          <div className="flex items-center justify-between pb-3 border-b border-[#E6E8E2] mb-3">
            <h4 className="text-sm font-bold text-[#17213B]">Session Scan Feed</h4>
            <span className="text-[11px] font-semibold text-[#7B8794]">
              {recentScans.length} scan{recentScans.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {recentScans.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <Clock className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-xs font-semibold text-slate-500">No scans in this session yet</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Start the camera or upload an image to begin checking students in.
                </p>
              </div>
            ) : (
              recentScans.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    item.isSuccess
                      ? item.resultCode === 'ALREADY_RECORDED'
                        ? 'bg-amber-50/60 border-amber-200 text-amber-900'
                        : 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50/60 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-900">{item.studentName}</p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {item.studentCode} • {item.message.slice(0, 32)}...
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="font-mono font-bold text-[11px] block">{item.time}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        item.isSuccess ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
