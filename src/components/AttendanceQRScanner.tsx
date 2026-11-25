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
  ArrowRight,
} from 'lucide-react';
import { attendanceService, QRAttendanceResult } from '../services/attendanceService';
import { GroupClass } from '../types/database';
import { useOptionalAuth } from '../contexts/authState';
import { usePreferences } from '../contexts/preferencesState';
import { translateAttendanceStatus, TranslationKey } from '../i18n/translations';

type ScannedAttendanceMeta = NonNullable<QRAttendanceResult['attendance']> & {
  student_name?: string;
  student_code?: string;
};

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

const SCAN_CODE_KEY_MAP: Record<string, TranslationKey> = {
  RECORDED: 'qrCodeRecorded',
  ALREADY_RECORDED: 'qrCodeAlreadyRecorded',
  CONFLICT_EXISTS: 'qrCodeConflictExists',
  GROUP_MISMATCH: 'qrCodeGroupMismatch',
  HISTORICAL_GROUP_MISMATCH: 'qrCodeHistoricalGroupMismatch',
  GROUP_REQUIRED: 'qrCodeGroupRequired',
  STUDENT_UNASSIGNED: 'qrCodeStudentUnassigned',
  INACTIVE_STUDENT: 'qrCodeInactiveStudent',
  INVALID_TOKEN: 'qrCodeInvalidToken',
  EMPTY_TOKEN: 'qrCodeEmptyToken',
  ERROR: 'qrCodeError',
  NOT_FOUND: 'qrCodeNotFound',
};

export const AttendanceQRScanner: React.FC<AttendanceQRScannerProps> = ({
  classesList,
  selectedGroupId,
  onSelectGroupId,
  onAttendanceRecorded,
  mutationsDisabled = false,
}) => {
  const auth = useOptionalAuth();
  const { language, t } = usePreferences();
  const isSessionRevalidating = Boolean(mutationsDisabled || auth?.isRevalidating);
  const isSessionRevalidatingRef = useRef(isSessionRevalidating);
  useEffect(() => {
    isSessionRevalidatingRef.current = isSessionRevalidating;
  }, [isSessionRevalidating]);

  const [scanMode, setScanMode] = useState<'camera' | 'upload' | 'manual'>('camera');

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const cameraRequestedRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

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

  const lastScannedTokenRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const isExecutingRef = useRef<boolean>(false);

  const [recentScans, setRecentScans] = useState<ScanFeedItem[]>([]);
  const [manualToken, setManualToken] = useState('');

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  const handleSelectScanMode = (nextMode: 'camera' | 'upload' | 'manual') => {
    if (nextMode !== 'camera' && (isCameraActive || cameraRequestedRef.current)) {
      stopCamera();
    }
    setScanMode(nextMode);
  };

  const processQRCode = useCallback(
    async (rawCode: string) => {
      if (isSessionRevalidatingRef.current) {
        setLastScanResult({
          success: false,
          code: 'REVALIDATING',
          message: t('qrErrRevalidatingScan'),
        });
        return;
      }

      const token = rawCode.trim();
      if (!token) return;

      const now = Date.now();
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
          const att = outcome.attendance as ScannedAttendanceMeta | undefined;

          setLastScanResult({
            success: outcome.success,
            code: outcome.code,
            message: outcome.message,
            studentName: att?.student_name,
            studentCode: att?.student_code,
            checkInTime: att?.check_in_time,
            status: att?.status,
          });

          const feedEntry: ScanFeedItem = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            studentName: att?.student_name || 'Student',
            studentCode: att?.student_code || token.slice(0, 10),
            status: att?.status || (outcome.success ? 'Present' : 'Failed'),
            time:
              att?.check_in_time ||
              new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
            resultCode: outcome.code,
            isSuccess: outcome.success,
            message: outcome.message,
          };

          setRecentScans((prev) => [feedEntry, ...prev.slice(0, 19)]);

          if (outcome.success && onAttendanceRecorded) {
            onAttendanceRecorded();
          }
        }
      } catch (err: unknown) {
        setLastScanResult({
          success: false,
          code: 'ERROR',
          message: err instanceof Error ? err.message : t('qrErrProcessFailed'),
        });
      } finally {
        setIsProcessing(false);
        isExecutingRef.current = false;
      }
    },
    [selectedGroupId, onAttendanceRecorded, t]
  );

  const scanCurrentVideoFrame = useCallback(() => {
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
  }, [isCameraActive, processQRCode]);

  useEffect(() => {
    if (!isCameraActive) return;

    let active = true;
    const loop = () => {
      if (!active) return;
      scanCurrentVideoFrame();
      if (active) {
        animationFrameRef.current = requestAnimationFrame(loop);
      }
    };

    animationFrameRef.current = requestAnimationFrame(loop);
    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isCameraActive, scanCurrentVideoFrame]);

  const startCamera = async () => {
    if (isSessionRevalidatingRef.current) {
      setCameraError(t('qrErrRevalidatingCam'));
      return;
    }
    if (!selectedGroupId) {
      setCameraError(t('qrErrSelectGroupCam'));
      return;
    }

    setCameraError(null);
    cameraRequestedRef.current = true;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(t('qrErrCamNotSupported'));
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (
        !cameraRequestedRef.current ||
        !isMountedRef.current ||
        scanMode !== 'camera' ||
        isSessionRevalidatingRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: unknown) {
      stopCamera();
      const errName =
        typeof err === 'object' && err !== null && 'name' in err
          ? String((err as { name: unknown }).name)
          : '';
      let msg = err instanceof Error && err.message ? err.message : t('qrErrCamAccessFallback');
      if (errName === 'NotAllowedError') {
        msg = t('qrErrCamPermissionDenied');
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        msg = t('qrErrCamNotFound');
      }
      setCameraError(msg);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isSessionRevalidatingRef.current) {
      setLastScanResult({
        success: false,
        code: 'REVALIDATING',
        message: t('qrErrRevalidatingUpload'),
      });
      e.target.value = '';
      return;
    }

    if (!selectedGroupId) {
      setLastScanResult({
        success: false,
        code: 'GROUP_REQUIRED',
        message: t('qrErrSelectGroupUpload'),
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
          message: t('qrErrRevalidatingDecode'),
        });
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (isSessionRevalidatingRef.current) {
          setLastScanResult({
            success: false,
            code: 'REVALIDATING',
            message: t('qrErrRevalidatingUpload'),
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
            message: t('qrErrNotFoundMsg'),
          });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);

    e.target.value = '';
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionRevalidatingRef.current) {
      setLastScanResult({
        success: false,
        code: 'REVALIDATING',
        message: t('qrErrRevalidatingManual'),
      });
      return;
    }
    if (!selectedGroupId) {
      setLastScanResult({
        success: false,
        code: 'GROUP_REQUIRED',
        message: t('qrErrSelectGroupManual'),
      });
      return;
    }
    if (!manualToken.trim()) return;
    processQRCode(manualToken.trim());
    setManualToken('');
  };

  const resultBadgeTitleKey = lastScanResult ? SCAN_CODE_KEY_MAP[lastScanResult.code] : undefined;

  const formatScanMessage = (
    code: string,
    rawMessage: string,
    studentName?: string,
    time?: string,
    status?: string
  ) => {
    if (language !== 'ar') return rawMessage;
    if (code === 'ALREADY_RECORDED' && studentName && time) {
      return t('qrAlreadyRecordedDetail', {
        name: studentName,
        time,
        status: translateAttendanceStatus(language, status || 'Present'),
      });
    }
    if ((code === 'SUCCESS' || code === 'RECORDED') && studentName && time) {
      return t('qrRecordedSuccessDetail', {
        name: studentName,
        time,
        status: translateAttendanceStatus(language, status || 'Present'),
      });
    }
    return rawMessage;
  };

  return (
    <div className="space-y-6">
      {isSessionRevalidating && (
        <div
          data-testid="qr-revalidating-banner"
          role="status"
          className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
          <span className="font-semibold">{t('qrRevalidatingBanner')}</span>
        </div>
      )}

      {/* Top Controls Card */}
      <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-[#17213B] dark:text-white">{t('qrScannerTitle')}</h3>
            <p className="text-xs text-[#7B8794] dark:text-slate-400">{t('qrScannerSubtitle')}</p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center justify-center sm:w-fit bg-[#F8F7F2] dark:bg-[#0D1520] p-1 rounded-2xl border border-[#E6E8E2] dark:border-slate-800 gap-1 sm:gap-0">
            <button
              onClick={() => handleSelectScanMode('camera')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                scanMode === 'camera'
                  ? 'bg-white dark:bg-slate-800 text-[#174E50] dark:text-teal-300 shadow-xs'
                  : 'text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              {t('qrModeCamera')}
            </button>
            <button
              onClick={() => handleSelectScanMode('upload')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                scanMode === 'upload'
                  ? 'bg-white dark:bg-slate-800 text-[#174E50] dark:text-teal-300 shadow-xs'
                  : 'text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              {t('qrModeUpload')}
            </button>
            <button
              onClick={() => handleSelectScanMode('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                scanMode === 'manual'
                  ? 'bg-white dark:bg-slate-800 text-[#174E50] dark:text-teal-300 shadow-xs'
                  : 'text-[#7B8794] dark:text-slate-400 hover:text-[#17213B] dark:hover:text-white'
              }`}
            >
              <FileImage className="w-3.5 h-3.5" />
              {t('qrModeManual')}
            </button>
          </div>
        </div>

        {/* Group Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-bold text-[#17213B] dark:text-slate-200 mb-1.5">
              {t('targetClassGroupLabel')} <span className="text-rose-500">*</span>
            </label>
            <select
              value={selectedGroupId}
              onChange={(e) => onSelectGroupId(e.target.value)}
              className="w-full h-[42px] px-3.5 py-2 rounded-xl border border-[#E6E8E2] dark:border-slate-700 text-xs font-medium text-[#17213B] dark:text-white bg-white dark:bg-[#0D1520] focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400 truncate"
            >
              {classesList.length === 0 ? (
                <option value="">{t('noClassesAvailableOption')}</option>
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
            <div className="w-full bg-[#D8E8DC]/40 dark:bg-teal-950/50 border border-[#A8BDA6]/40 dark:border-teal-800/50 rounded-xl p-2.5 flex items-center gap-2 text-xs text-[#174E50] dark:text-teal-200">
              <Clock className="w-4 h-4 shrink-0 text-[#174E50] dark:text-teal-300" />
              <span>
                {t('qrServerTimestampNoticePre')} <strong className="font-semibold">Africa/Cairo</strong>{' '}
                {t('qrServerTimestampNoticeMid')}{' '}
                <strong>{translateAttendanceStatus(language, 'Present')}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Scanner Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {scanMode === 'camera' && (
            <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-col items-center">
              <div className="relative w-full max-w-md aspect-[4/3] bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center border-2 border-[#174E50]/20 dark:border-teal-700/40 shadow-inner">
                <canvas ref={canvasRef} className="hidden" />

                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
                />

                {!isCameraActive && (
                  <div className="text-center p-6 text-slate-400 space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-slate-300">
                      <Camera className="w-7 h-7" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">{t('cameraIsOff')}</h4>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs">{t('cameraOffDesc')}</p>
                    </div>
                  </div>
                )}

                {isCameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-52 h-52 border-2 border-teal-400 rounded-2xl relative animate-pulse">
                      <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-teal-400" />
                      <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-teal-400" />
                      <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-teal-400" />
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-teal-400" />
                    </div>
                  </div>
                )}

                {isProcessing && (
                  <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center gap-2 text-white text-xs font-bold">
                    <RefreshCw className="w-4 h-4 animate-spin text-teal-300" />
                    <span>{t('verifyingStudentCard')}</span>
                  </div>
                )}
              </div>

              {cameraError && (
                <div className="w-full max-w-md mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-700/50 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{cameraError}</span>
                </div>
              )}

              <div className="mt-5 flex items-center gap-3">
                {!isCameraActive ? (
                  <button
                    onClick={startCamera}
                    disabled={!selectedGroupId || isSessionRevalidating}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#174E50] hover:bg-[#134042] dark:bg-[#147477] dark:hover:bg-[#106063] text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed transition shadow-xs cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    {selectedGroupId ? t('startCameraBtn') : t('selectGroupToScanBtn')}
                  </button>
                ) : (
                  <button
                    onClick={stopCamera}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition shadow-xs cursor-pointer"
                  >
                    <CameraOff className="w-4 h-4" />
                    {t('stopCameraBtn')}
                  </button>
                )}
              </div>
            </div>
          )}

          {scanMode === 'upload' && (
            <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-8 border border-[#E6E8E2] dark:border-slate-800 shadow-xs text-center">
              <div className="max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-[#D8E8DC]/40 dark:bg-teal-950/60 border border-[#A8BDA6]/40 dark:border-teal-800/60 flex items-center justify-center mx-auto text-[#174E50] dark:text-teal-300">
                  <Upload className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-[#17213B] dark:text-white">
                    {t('uploadCardImageTitle')}
                  </h4>
                  <p className="text-xs text-[#7B8794] dark:text-slate-400 mt-1">
                    {t('uploadCardImageDesc')}
                  </p>
                </div>

                <label
                  className={`inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#174E50] hover:bg-[#134042] dark:bg-[#147477] dark:hover:bg-[#106063] text-white text-xs font-bold transition shadow-xs ${
                    !selectedGroupId || isSessionRevalidating
                      ? 'opacity-50 cursor-not-allowed pointer-events-none'
                      : 'cursor-pointer'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>{t('chooseImageFileBtn')}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={!selectedGroupId || isSessionRevalidating}
                    className="hidden"
                  />
                </label>

                <p className="text-[11px] text-[#7B8794] dark:text-slate-400">
                  {t('uploadFormatsNote')}
                </p>
              </div>
            </div>
          )}

          {scanMode === 'manual' && (
            <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs">
              <h4 className="text-sm font-bold text-[#17213B] dark:text-white mb-1">
                {t('directTokenSimTitle')}
              </h4>
              <p className="text-xs text-[#7B8794] dark:text-slate-400 mb-4">
                {t('directTokenSimDesc')}
              </p>

              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder={t('pasteQrHashPlaceholder')}
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E6E8E2] dark:border-slate-700 bg-white dark:bg-[#0D1520] text-xs font-medium text-[#17213B] dark:text-white focus:outline-none focus:border-[#174E50] dark:focus:border-teal-400"
                />
                <button
                  type="submit"
                  disabled={!manualToken.trim() || isProcessing || isSessionRevalidating}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#174E50] hover:bg-[#134042] dark:bg-[#147477] dark:hover:bg-[#106063] text-white text-xs font-bold disabled:opacity-50 transition cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4 rtl:rotate-180" />
                  {t('submitScanBtn')}
                </button>
              </form>
            </div>
          )}

          {lastScanResult && (
            <div
              className={`p-5 rounded-2xl border transition-all ${
                lastScanResult.success
                  ? lastScanResult.code === 'ALREADY_RECORDED'
                    ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-700/50 dark:text-amber-200'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-700/50 dark:text-emerald-200'
                  : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-700/50 dark:text-rose-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {lastScanResult.success ? (
                    lastScanResult.code === 'ALREADY_RECORDED' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    )
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                  )}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider">
                      {resultBadgeTitleKey ? t(resultBadgeTitleKey) : lastScanResult.code}
                    </span>
                    {lastScanResult.checkInTime && (
                      <span className="text-xs font-mono font-bold bg-white/70 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                        {lastScanResult.checkInTime}
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-medium leading-relaxed">
                    {formatScanMessage(
                      lastScanResult.code,
                      lastScanResult.message,
                      lastScanResult.studentName,
                      lastScanResult.checkInTime,
                      lastScanResult.status
                    )}
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
                        <span className="px-2 py-0.5 rounded bg-white/80 dark:bg-slate-800/80 text-[10px] uppercase font-bold">
                          {translateAttendanceStatus(language, lastScanResult.status)}
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
        <div className="bg-white dark:bg-[#131E2B] rounded-3xl p-6 border border-[#E6E8E2] dark:border-slate-800 shadow-xs flex flex-col h-[520px]">
          <div className="flex items-center justify-between pb-3 border-b border-[#E6E8E2] dark:border-slate-800 mb-3">
            <h4 className="text-sm font-bold text-[#17213B] dark:text-white">
              {t('sessionScanFeedTitle')}
            </h4>
            <span className="text-[11px] font-semibold text-[#7B8794] dark:text-slate-400">
              {recentScans.length === 1
                ? t('scanCountSingular', { count: recentScans.length })
                : t('scanCountPlural', { count: recentScans.length })}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pe-1">
            {recentScans.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <Clock className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  {t('noScansSessionTitle')}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  {t('noScansSessionDesc')}
                </p>
              </div>
            ) : (
              recentScans.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    item.isSuccess
                      ? item.resultCode === 'ALREADY_RECORDED'
                        ? 'bg-amber-50/60 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-200'
                        : 'bg-emerald-50/60 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-200'
                      : 'bg-rose-50/60 border-rose-200 text-rose-900 dark:bg-rose-950/30 dark:border-rose-800/50 dark:text-rose-200'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white truncate">{item.studentName}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
                      {item.studentCode} •{' '}
                      {formatScanMessage(
                        item.resultCode,
                        item.message,
                        item.studentName,
                        item.time,
                        item.status
                      ).slice(0, 42)}
                      ...
                    </p>
                  </div>
                  <div className="text-end shrink-0 ms-2">
                    <span className="font-mono font-bold text-[11px] block">{item.time}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                        item.isSuccess
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
                      }`}
                    >
                      {translateAttendanceStatus(language, item.status)}
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
