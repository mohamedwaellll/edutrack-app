import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import type { ServiceResult } from './adminService';

export const ASSIGNMENT_ATTACHMENT_BUCKET = 'assignment-attachments';
export const SUBMISSION_ATTACHMENT_BUCKET = 'assignment-submissions';
export const MAX_ASSIGNMENT_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

export type AttachmentValidationErrorCode = 'INVALID_TYPE' | 'EMPTY_FILE' | 'TOO_LARGE';

export function validateAssignmentPdfFile(file: File): {
  valid: boolean;
  errorCode?: AttachmentValidationErrorCode;
} {
  const nameLower = file.name.trim().toLowerCase();
  const mimeLower = (file.type || '').trim().toLowerCase();
  const isPdfMime = mimeLower === 'application/pdf' || mimeLower === '';
  const isPdfExt = nameLower.endsWith('.pdf');

  if (!isPdfExt || !isPdfMime) {
    return { valid: false, errorCode: 'INVALID_TYPE' };
  }
  if (file.size <= 0) {
    return { valid: false, errorCode: 'EMPTY_FILE' };
  }
  if (file.size > MAX_ASSIGNMENT_PDF_BYTES) {
    return { valid: false, errorCode: 'TOO_LARGE' };
  }
  return { valid: true };
}

export function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  const kb = Math.max(1, Math.round(sizeBytes / 1024));
  return `${kb} KB`;
}

export function buildAssignmentAttachmentPath(groupId: string): string {
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `${groupId}/${token}.pdf`;
}

export function buildSubmissionAttachmentPath(studentId: string, assignmentId: string): string {
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return `${studentId}/${assignmentId}/${token}.pdf`;
}

async function authorizeAndSignAttachment(
  rpcName: 'authorize_assignment_attachment_download' | 'authorize_submission_attachment_download',
  attachmentId: string
): Promise<ServiceResult<{ signedUrl: string; fileName: string }>> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: 'Supabase is not configured.' };
  }

  const trimmedId = attachmentId.trim();
  if (!trimmedId) {
    return { data: null, error: 'Attachment ID is required.' };
  }

  try {
    const { data, error } = await supabase.rpc(rpcName, {
      p_attachment_id: trimmedId,
    });

    if (error) {
      return { data: null, error: error.message || 'Access denied: Unable to open attachment.' };
    }

    const payload = data as { attachment?: Record<string, unknown> } | null;
    const att = payload?.attachment;
    if (
      !att ||
      typeof att.bucket_id !== 'string' ||
      typeof att.object_path !== 'string' ||
      typeof att.file_name !== 'string'
    ) {
      return { data: null, error: 'Invalid attachment authorization response.' };
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from(att.bucket_id)
      .createSignedUrl(att.object_path, 60);

    if (signError || !signedData?.signedUrl) {
      return {
        data: null,
        error: signError?.message || 'Unable to generate secure download link.',
      };
    }

    return {
      data: {
        signedUrl: signedData.signedUrl,
        fileName: att.file_name,
      },
      error: null,
    };
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unable to open assignment attachment.',
    };
  }
}

export async function getAuthorizedAttachmentDownloadUrl(
  attachmentId: string
): Promise<ServiceResult<{ signedUrl: string; fileName: string }>> {
  return authorizeAndSignAttachment('authorize_assignment_attachment_download', attachmentId);
}

export async function getAuthorizedSubmissionAttachmentDownloadUrl(
  attachmentId: string
): Promise<ServiceResult<{ signedUrl: string; fileName: string }>> {
  return authorizeAndSignAttachment('authorize_submission_attachment_download', attachmentId);
}
