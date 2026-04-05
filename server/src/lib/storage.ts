import { supabase } from './supabase.js';

const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour max — GDPR requirement

export async function generateSignedUrl(
  bucket: string,
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

export async function generateUploadSignedUrl(
  bucket: string,
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error) {
    throw new Error(`Failed to generate upload URL: ${error.message}`);
  }

  return data.signedUrl;
}

export async function deleteFile(bucket: string, paths: string[]): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove(paths);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}
