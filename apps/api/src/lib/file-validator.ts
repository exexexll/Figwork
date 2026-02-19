/**
 * File validation and security scanning utilities
 */

// Magic bytes for file type detection
const FILE_SIGNATURES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  docx: [[0x50, 0x4B, 0x03, 0x04]], // PK (ZIP-based)
  zip: [[0x50, 0x4B, 0x03, 0x04]],
  png: [[0x89, 0x50, 0x4E, 0x47]],
  jpg: [[0xFF, 0xD8, 0xFF]],
  gif: [[0x47, 0x49, 0x46, 0x38]], // GIF8
};

// Dangerous patterns to check in text content
const DANGEROUS_PATTERNS = [
  // JavaScript injection
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i, // onclick=, onload=, etc.
  
  // SQL injection indicators
  /;\s*drop\s+table/i,
  /;\s*delete\s+from/i,
  /union\s+select/i,
  
  // Shell injection
  /;\s*rm\s+-rf/i,
  /;\s*wget\s+/i,
  /;\s*curl\s+/i,
  
  // PHP code
  /<\?php/i,
  
  // Server-side includes
  /<!--#exec/i,
  /<!--#include/i,
];

// Maximum file sizes (in bytes)
const MAX_FILE_SIZES: Record<string, number> = {
  pdf: 50 * 1024 * 1024, // 50MB
  docx: 25 * 1024 * 1024, // 25MB
  txt: 5 * 1024 * 1024, // 5MB
  md: 5 * 1024 * 1024, // 5MB
};

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

/**
 * Validate file type by checking magic bytes
 */
export function validateFileType(
  buffer: Buffer,
  expectedType: string
): ValidationResult {
  const signatures = FILE_SIGNATURES[expectedType];
  
  // For text files, we can't check magic bytes
  if (expectedType === 'txt' || expectedType === 'md') {
    // Check if it's valid UTF-8 text
    try {
      const text = buffer.toString('utf-8');
      // Check for null bytes (binary indicator)
      if (text.includes('\0')) {
        return { valid: false, error: 'File contains binary data' };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'Invalid text encoding' };
    }
  }

  if (!signatures) {
    return { valid: true }; // Unknown type, allow
  }

  const headerBytes = Array.from(buffer.subarray(0, 8));
  
  for (const signature of signatures) {
    const matches = signature.every((byte, index) => headerBytes[index] === byte);
    if (matches) {
      return { valid: true };
    }
  }

  return { 
    valid: false, 
    error: `File does not match expected ${expectedType.toUpperCase()} format` 
  };
}

/**
 * Validate file size
 */
export function validateFileSize(
  sizeBytes: number,
  fileType: string,
  maxSizeMb?: number
): ValidationResult {
  const maxBytes = maxSizeMb 
    ? maxSizeMb * 1024 * 1024 
    : MAX_FILE_SIZES[fileType] || 10 * 1024 * 1024;

  if (sizeBytes > maxBytes) {
    return { 
      valid: false, 
      error: `File exceeds maximum size of ${Math.round(maxBytes / 1024 / 1024)}MB` 
    };
  }

  if (sizeBytes === 0) {
    return { valid: false, error: 'File is empty' };
  }

  return { valid: true };
}

/**
 * Scan text content for dangerous patterns
 */
export function scanTextContent(content: string): ValidationResult {
  const warnings: string[] = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }

  if (warnings.length > 10) {
    return { 
      valid: false, 
      error: 'File contains multiple suspicious patterns and may be malicious' 
    };
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Validate filename
 */
export function validateFilename(filename: string): ValidationResult {
  // Check for path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, error: 'Invalid filename - path traversal detected' };
  }

  // Check for null bytes
  if (filename.includes('\0')) {
    return { valid: false, error: 'Invalid filename - null byte detected' };
  }

  // Check length
  if (filename.length > 255) {
    return { valid: false, error: 'Filename too long' };
  }

  // Check for double extensions (potential bypass)
  const extensions = filename.split('.').slice(1);
  const dangerousExtensions = ['exe', 'bat', 'cmd', 'sh', 'php', 'jsp', 'asp', 'cgi'];
  
  for (const ext of extensions) {
    if (dangerousExtensions.includes(ext.toLowerCase())) {
      return { valid: false, error: `Dangerous file extension detected: .${ext}` };
    }
  }

  return { valid: true };
}

/**
 * Full file validation
 */
export async function validateFile(
  buffer: Buffer,
  filename: string,
  expectedType: string,
  maxSizeMb?: number
): Promise<ValidationResult> {
  // 1. Validate filename
  const filenameResult = validateFilename(filename);
  if (!filenameResult.valid) return filenameResult;

  // 2. Validate file size
  const sizeResult = validateFileSize(buffer.length, expectedType, maxSizeMb);
  if (!sizeResult.valid) return sizeResult;

  // 3. Validate file type (magic bytes)
  const typeResult = validateFileType(buffer, expectedType);
  if (!typeResult.valid) return typeResult;

  // 4. Scan text content (for text-based files)
  if (expectedType === 'txt' || expectedType === 'md') {
    const content = buffer.toString('utf-8');
    const contentResult = scanTextContent(content);
    if (!contentResult.valid) return contentResult;
    return contentResult; // May include warnings
  }

  return { valid: true };
}

/**
 * Sanitize filename for storage
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace special chars
    .replace(/\.{2,}/g, '.') // Remove multiple dots
    .replace(/^\.+|\.+$/g, '') // Remove leading/trailing dots
    .slice(0, 200); // Limit length
}
