const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'hadlay-kalan/stories',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1080, height: 1920, crop: 'limit' }]
  }
});

const storyUpload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

module.exports = storyUpload;
