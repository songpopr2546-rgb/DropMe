const multer = require('multer');
const sharp = require('sharp');

const upload = multer({ storage: multer.memoryStorage() });

const runMiddleware = (req, res, fn) =>
    new Promise((resolve, reject) =>
        fn(req, res, (result) => (result instanceof Error ? reject(result) : resolve(result)))
    );

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        await runMiddleware(req, res, upload.single('image'));

        if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

        let maxSizeMB = parseFloat(req.body.maxSize);
        if (isNaN(maxSizeMB)) maxSizeMB = 1.9;
        const MAX_SIZE_BYTES = maxSizeMB * 1024 * 1024;

        const inputBuffer = req.file.buffer;
        const format = req.body.format || 'webp';
        const mode = req.body.mode || 'compress';

        let processBuffer = inputBuffer;
        const maxWidth = parseInt(req.body.maxWidth);
        const maxHeight = parseInt(req.body.maxHeight);

        let shouldResize = false;
        const resizeOpts = { withoutEnlargement: true, fit: 'inside' };
        if (!isNaN(maxWidth) && maxWidth > 0) { resizeOpts.width = maxWidth; shouldResize = true; }
        if (!isNaN(maxHeight) && maxHeight > 0) { resizeOpts.height = maxHeight; shouldResize = true; }
        if (shouldResize) { processBuffer = await sharp(inputBuffer).resize(resizeOpts).toBuffer(); }

        if (mode === 'compress' && processBuffer.length <= MAX_SIZE_BYTES && !shouldResize) {
            return res.json({
                success: true, message: 'Already under target size.',
                originalSize: inputBuffer.length, finalSize: processBuffer.length,
                settings: { status: 'Skipped' }, isUnderLimit: true,
                dataUrl: `data:${req.file.mimetype};base64,${processBuffer.toString('base64')}`
            });
        }

        let bestBuffer = null;
        let bestSetting = null;

        if (mode === 'convert') {
            if (format === 'webp') { bestBuffer = await sharp(processBuffer).webp({ quality: 85 }).toBuffer(); bestSetting = { quality: 85, status: 'Convert Only' }; }
            else if (format === 'jpeg') { bestBuffer = await sharp(processBuffer).jpeg({ quality: 85 }).toBuffer(); bestSetting = { quality: 85, status: 'Convert Only' }; }
            else if (format === 'avif') { bestBuffer = await sharp(processBuffer).avif({ quality: 70, effort: 4 }).toBuffer(); bestSetting = { quality: 70, status: 'Convert Only' }; }
            else { bestBuffer = await sharp(processBuffer).png({ compressionLevel: 9 }).toBuffer(); bestSetting = { quality: 100, status: 'Convert Only' }; }
        } else {
            const settingsMap = {
                webp:  [90, 75, 50, 30, 10].map(q => ({ quality: q, effort: 6 })),
                jpeg:  [90, 75, 50, 30, 10].map(q => ({ quality: q })),
                avif:  [80, 60, 40, 20].map(q => ({ quality: q, effort: 4 })),
                png:   [
                    { quality: 70, colors: 256 }, { quality: 50, colors: 128 },
                    { quality: 30, colors: 64 },  { quality: 10, colors: 16 },
                    { quality: 10, colors: 16, dither: 0 }, { quality: 10, colors: 8, dither: 0 },
                    { quality: 10, colors: 4, dither: 0 },  { quality: 10, colors: 2, dither: 0 }
                ]
            };

            for (const setting of (settingsMap[format] || settingsMap.webp)) {
                let buf;
                if (format === 'webp') buf = await sharp(processBuffer).webp(setting).toBuffer();
                else if (format === 'jpeg') buf = await sharp(processBuffer).jpeg(setting).toBuffer();
                else if (format === 'avif') buf = await sharp(processBuffer).avif(setting).toBuffer();
                else {
                    const cfg = { palette: true, quality: setting.quality, colors: setting.colors, compressionLevel: 9, effort: 10 };
                    if (setting.dither !== undefined) cfg.dither = setting.dither;
                    buf = await sharp(processBuffer).png(cfg).toBuffer();
                }
                if (buf.length <= MAX_SIZE_BYTES) { bestBuffer = buf; bestSetting = setting; break; }
                if (!bestBuffer || buf.length < bestBuffer.length) { bestBuffer = buf; bestSetting = setting; }
            }
        }

        if (!bestBuffer) return res.status(500).json({ error: 'Compression failed.' });

        const mimeMap = { webp: 'image/webp', jpeg: 'image/jpeg', avif: 'image/avif', png: 'image/png' };
        const mimeType = mimeMap[format] || 'image/webp';
        const isSuccess = mode === 'convert' ? true : bestBuffer.length <= MAX_SIZE_BYTES;

        res.json({
            success: true, isUnderLimit: isSuccess,
            originalSize: inputBuffer.length, finalSize: bestBuffer.length,
            settings: bestSetting,
            message: mode === 'convert' ? 'Successfully Converted' : (isSuccess ? 'Success' : 'Compressed as much as possible, still over target.'),
            dataUrl: `data:${mimeType};base64,${bestBuffer.toString('base64')}`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
