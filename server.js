const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');

const app = express();
const port = 3000;

// Setup static folder for frontend
app.use(express.static(__dirname));
app.use(express.json());

// Setup multer for in-memory file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post('/compress', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded.' });
        }

        let maxSizeMB = parseFloat(req.body.maxSize);
        if (isNaN(maxSizeMB)) maxSizeMB = 1.9;
        
        const MAX_SIZE_BYTES = maxSizeMB * 1024 * 1024;
        const inputBuffer = req.file.buffer;
        
        const format = req.body.format || 'webp';
        
        const mode = req.body.mode || 'compress';
        
        // Handle resizing if requested
        let processBuffer = inputBuffer;
        const maxWidth = parseInt(req.body.maxWidth);
        const maxHeight = parseInt(req.body.maxHeight);
        
        let shouldResize = false;
        const resizeOpts = { withoutEnlargement: true, fit: 'inside' };
        
        if (!isNaN(maxWidth) && maxWidth > 0) {
            resizeOpts.width = maxWidth;
            shouldResize = true;
        }
        if (!isNaN(maxHeight) && maxHeight > 0) {
            resizeOpts.height = maxHeight;
            shouldResize = true;
        }
        
        if (shouldResize) {
            processBuffer = await sharp(inputBuffer)
                .resize(resizeOpts)
                .toBuffer();
        }
        
        if (mode === 'compress' && processBuffer.length <= MAX_SIZE_BYTES && !shouldResize) {
            // Already small enough and no resize requested
            return res.json({
                success: true,
                message: 'Image already below target size and no resize needed.',
                originalSize: inputBuffer.length,
                finalSize: processBuffer.length,
                settings: { status: 'Skipped' },
                dataUrl: `data:${req.file.mimetype};base64,${processBuffer.toString('base64')}`
            });
        }

        let bestBuffer = null;
        let bestSetting = null;
        
        if (mode === 'convert') {
            // Conversion mode: Single pass at standard high quality, ignore size limits
            if (format === 'webp') {
                bestBuffer = await sharp(processBuffer).webp({ quality: 85, effort: 6 }).toBuffer();
                bestSetting = { quality: 85, status: 'Convert Only' };
            } else if (format === 'jpeg' || format === 'jpg') {
                bestBuffer = await sharp(processBuffer).jpeg({ quality: 85 }).toBuffer();
                bestSetting = { quality: 85, status: 'Convert Only' };
            } else if (format === 'avif') {
                bestBuffer = await sharp(processBuffer).avif({ quality: 70, effort: 4 }).toBuffer();
                bestSetting = { quality: 70, status: 'Convert Only' };
            } else {
                bestBuffer = await sharp(processBuffer).png({ quality: 100, compressionLevel: 9 }).toBuffer();
                bestSetting = { quality: 100, status: 'Convert Only' };
            }
        } else {
            // Compress mode: Aggressively target MAX_SIZE_BYTES
            if (format === 'webp') {
                const webpSettings = [
                    { quality: 90, effort: 6 },
                    { quality: 75, effort: 6 },
                    { quality: 50, effort: 6 },
                    { quality: 30, effort: 6 },
                    { quality: 10, effort: 6 }
                ];
                
                for (const setting of webpSettings) {
                    const compressedBuffer = await sharp(processBuffer)
                        .webp(setting)
                        .toBuffer();

                    if (compressedBuffer.length <= MAX_SIZE_BYTES) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                        break;
                    }
                    
                    if (!bestBuffer || compressedBuffer.length < bestBuffer.length) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                    }
                }
            } else if (format === 'jpeg' || format === 'jpg') {
                const jpegSettings = [
                    { quality: 90 }, { quality: 75 }, { quality: 50 }, { quality: 30 }, { quality: 10 }
                ];
                
                for (const setting of jpegSettings) {
                    const compressedBuffer = await sharp(processBuffer)
                        .jpeg(setting)
                        .toBuffer();

                    if (compressedBuffer.length <= MAX_SIZE_BYTES) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                        break;
                    }
                    
                    if (!bestBuffer || compressedBuffer.length < bestBuffer.length) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                    }
                }
            } else if (format === 'avif') {
                const avifSettings = [
                    { quality: 80, effort: 4 }, { quality: 60, effort: 4 }, { quality: 40, effort: 4 }, { quality: 20, effort: 4 }
                ];
                
                for (const setting of avifSettings) {
                    const compressedBuffer = await sharp(processBuffer)
                        .avif(setting)
                        .toBuffer();

                    if (compressedBuffer.length <= MAX_SIZE_BYTES) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                        break;
                    }
                    
                    if (!bestBuffer || compressedBuffer.length < bestBuffer.length) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                    }
                }
            } else {
                const pngSettings = [
                    { quality: 70, colors: 256 },
                    { quality: 50, colors: 128 },
                    { quality: 30, colors: 64 },
                    { quality: 10, colors: 16 },
                    { quality: 10, colors: 16, dither: 0 },
                    { quality: 10, colors: 8, dither: 0 },
                    { quality: 10, colors: 4, dither: 0 },
                    { quality: 10, colors: 2, dither: 0 }
                ];

                for (const setting of pngSettings) {
                    let pngConfig = { 
                        palette: true,
                        quality: setting.quality,
                        colors: setting.colors,
                        compressionLevel: 9,
                        effort: 10 
                    };
                    if (setting.dither !== undefined) {
                        pngConfig.dither = setting.dither;
                    }

                    const compressedBuffer = await sharp(processBuffer)
                        .png(pngConfig)
                        .toBuffer();

                    if (compressedBuffer.length <= MAX_SIZE_BYTES) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                        break;
                    }
                    
                    if (!bestBuffer || compressedBuffer.length < bestBuffer.length) {
                        bestBuffer = compressedBuffer;
                        bestSetting = setting;
                    }
                }
            }
        }

        if (!bestBuffer) {
             return res.status(500).json({ error: 'Compression failed completely.' });
        }

        const mimeType = format === 'webp' ? 'image/webp' : 
                         format === 'jpeg' ? 'image/jpeg' : 
                         format === 'avif' ? 'image/avif' : 'image/png';
                         
        const dataUrl = `data:${mimeType};base64,${bestBuffer.toString('base64')}`;
        const isSuccess = mode === 'convert' ? true : bestBuffer.length <= MAX_SIZE_BYTES;

        res.json({
            success: true,
            isUnderLimit: isSuccess,
            originalSize: inputBuffer.length,
            finalSize: bestBuffer.length,
            settings: bestSetting,
            message: mode === 'convert' ? 'Successfully Converted' : (isSuccess ? 'Success' : 'Compressed as much as possible, but still over target.'),
            dataUrl: dataUrl
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Image Compressor Web App running at http://localhost:${port}`);
});
