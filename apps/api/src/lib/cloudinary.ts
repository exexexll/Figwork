import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

// Configure Cloudinary
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.warn('Warning: Cloudinary environment variables not fully configured');
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

console.log(`Cloudinary configured for cloud: ${cloudName}`);

export { cloudinary };

/**
 * Generate upload parameters for direct client uploads.
 * Uses unsigned upload with preset if available, falls back to signed upload.
 */
export function generateSignedUploadParams(
  publicId: string, 
  folder: string,
  resourceType: 'raw' | 'image' | 'video' | 'auto' = 'raw'
): {
  uploadUrl: string;
  publicId: string;
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
  resourceType: string;
} {
  const timestamp = Math.round(Date.now() / 1000);
  const fullPublicId = `${folder}/${publicId}`;

  // For signed uploads, sign timestamp and public_id
  const paramsToSign: Record<string, string | number> = {
    timestamp,
    public_id: fullPublicId,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    apiSecret!
  );

  console.log('Generating signed upload params:', {
    cloudName,
    folder,
    publicId: fullPublicId,
    timestamp,
    resourceType,
  });

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    publicId: fullPublicId,
    timestamp,
    signature,
    apiKey: apiKey!,
    cloudName: cloudName!,
    folder,
    resourceType,
  };
}

/**
 * Generate parameters for unsigned upload (requires upload preset in Cloudinary dashboard)
 */
export function generateUnsignedUploadParams(
  publicId: string,
  folder: string,
  uploadPreset: string,
  resourceType: 'raw' | 'image' | 'video' | 'auto' = 'raw'
): {
  uploadUrl: string;
  publicId: string;
  uploadPreset: string;
  cloudName: string;
  folder: string;
  resourceType: string;
} {
  const fullPublicId = `${folder}/${publicId}`;
  
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    publicId: fullPublicId,
    uploadPreset,
    cloudName: cloudName!,
    folder,
    resourceType,
  };
}

/**
 * Generate a signed URL for private file access
 */
export function generateSignedUrl(publicId: string, expiresInSeconds: number = 3600, resourceType: 'raw' | 'video' | 'image' = 'raw'): string {
  return cloudinary.url(publicId, {
    secure: true,
    sign_url: true,
    type: 'upload', // Use 'upload' for publicly uploaded files
    resource_type: resourceType,
  });
}

/**
 * Generate a URL for audio/video files
 * Audio files in Cloudinary are stored with resource_type: 'video'
 */
export function generateAudioUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    secure: true,
    resource_type: 'video',
    format: 'mp3', // Convert webm to mp3 for broader compatibility
  });
}

/**
 * Delete a file from Cloudinary
 */
export async function deleteFile(publicId: string, resourceType: 'raw' | 'video' | 'image' = 'raw'): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

/**
 * Download file buffer from Cloudinary URL
 */
export async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
