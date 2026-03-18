import cloudinary from "cloudinary";
import streamifier from "streamifier";

// Configure Cloudinary
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload media (image or video) to Cloudinary
 * @param {Buffer} fileBuffer - File buffer from multer
 * @param {string} mediaType - 'image' or 'video'
 * @param {string} folder - Folder path in Cloudinary (e.g., 'support-tickets/customer')
 * @param {string} publicId - Optional custom public ID
 * @returns {Promise<{url: string, publicId: string, size: number}>}
 */
export async function uploadMediaToCloudinary(
  fileBuffer,
  mediaType,
  folder,
  publicId = null,
) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.v2.uploader.upload_stream(
      {
        folder: folder,
        resource_type: mediaType === "video" ? "video" : "image",
        public_id: publicId,
        quality: "auto", // Auto-optimize quality
        fetch_format: "auto", // Auto-optimize format
        // Video specific options
        ...(mediaType === "video" && {
          max_bytes: 100 * 1024 * 1024, // 100MB max for videos
          timeout: 60000, // 60 seconds timeout
        }),
        // Image specific options
        ...(mediaType === "image" && {
          max_bytes: 5 * 1024 * 1024, // 5MB max for images
        }),
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            size: result.bytes,
            duration: result.duration, // For videos
          });
        }
      },
    );

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
}

/**
 * Delete media from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {string} mediaType - 'image' or 'video'
 */
export async function deleteMediaFromCloudinary(publicId, mediaType) {
  try {
    const resourceType = mediaType === "video" ? "video" : "image";
    const result = await cloudinary.v2.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    return result;
  } catch (err) {
    console.error("Error deleting from Cloudinary:", err);
    throw err;
  }
}

/**
 * Validate file type and size
 * @param {object} file - Multer file object
 * @param {string} mediaType - Expected type: 'image' or 'video'
 * @returns {object} { valid: boolean, error: string }
 */
export function validateMediaFile(file, mediaType) {
  if (!file) {
    return { valid: false, error: "No file provided" };
  }

  const validImageTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  const validVideoTypes = [
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-ms-wmv",
  ];

  const validTypes = mediaType === "video" ? validVideoTypes : validImageTypes;

  if (!validTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error: `Invalid ${mediaType} type. Allowed: ${validTypes.join(", ")}`,
    };
  }

  const maxSize = mediaType === "video" ? 100 * 1024 * 1024 : 5 * 1024 * 1024; // 100MB video, 5MB image

  if (file.size > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024);
    return {
      valid: false,
      error: `File too large. Maximum ${maxSizeMB}MB`,
    };
  }

  return { valid: true };
}

export default {
  uploadMediaToCloudinary,
  deleteMediaFromCloudinary,
  validateMediaFile,
};
