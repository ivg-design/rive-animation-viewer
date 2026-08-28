        var MAX_RENDER_SURFACE_IMAGE_BYTES = 16 * 1024 * 1024;
        var MAX_RENDER_SURFACE_IMAGE_DIMENSION = 16384;
        var MAX_RENDER_SURFACE_IMAGE_PIXELS = 64 * 1024 * 1024;

        function imageBytesMatch(bytes, offset, expected) {
            if (!bytes || offset < 0 || offset + expected.length > bytes.length) return false;
            for (var index = 0; index < expected.length; index += 1) {
                if (bytes[offset + index] !== expected[index]) return false;
            }
            return true;
        }

        function readImageU16Be(bytes, offset) {
            return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
        }

        function readImageU16Le(bytes, offset) {
            return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
        }

        function readImageU24Le(bytes, offset) {
            return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) >>> 0;
        }

        function readImageU32Be(bytes, offset) {
            return ((bytes[offset] * 0x1000000)
                + (bytes[offset + 1] << 16)
                + (bytes[offset + 2] << 8)
                + bytes[offset + 3]) >>> 0;
        }

        function readImageU32Le(bytes, offset) {
            return (bytes[offset]
                + (bytes[offset + 1] << 8)
                + (bytes[offset + 2] << 16)
                + (bytes[offset + 3] * 0x1000000)) >>> 0;
        }

        function inspectJpegDimensions(bytes) {
            var offset = 2;
            while (offset + 3 < bytes.length) {
                if (bytes[offset] !== 0xff) {
                    offset += 1;
                    continue;
                }
                while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
                if (offset >= bytes.length) break;
                var marker = bytes[offset++];
                if (marker === 0x01 || marker === 0xd8 || marker === 0xd9
                    || (marker >= 0xd0 && marker <= 0xd7)) continue;
                if (offset + 1 >= bytes.length) break;
                var segmentLength = readImageU16Be(bytes, offset);
                if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
                var isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
                    || (marker >= 0xc5 && marker <= 0xc7)
                    || (marker >= 0xc9 && marker <= 0xcb)
                    || (marker >= 0xcd && marker <= 0xcf);
                if (isStartOfFrame && segmentLength >= 7) {
                    return {
                        format: 'JPEG',
                        height: readImageU16Be(bytes, offset + 3),
                        width: readImageU16Be(bytes, offset + 5),
                    };
                }
                offset += segmentLength;
            }
            throw new Error('The JPEG image header is malformed.');
        }

        function inspectWebpDimensions(bytes) {
            var chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
            if (chunk === 'VP8X' && bytes.length >= 30) {
                return {
                    format: 'WebP',
                    width: 1 + readImageU24Le(bytes, 24),
                    height: 1 + readImageU24Le(bytes, 27),
                };
            }
            if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
                return {
                    format: 'WebP',
                    width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
                    height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)),
                };
            }
            if (chunk === 'VP8 ' && bytes.length >= 30
                && imageBytesMatch(bytes, 23, [0x9d, 0x01, 0x2a])) {
                return {
                    format: 'WebP',
                    width: readImageU16Le(bytes, 26) & 0x3fff,
                    height: readImageU16Le(bytes, 28) & 0x3fff,
                };
            }
            throw new Error('The WebP image header is malformed.');
        }

        function inspectRenderSurfaceImage(bytes) {
            if (imageBytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
                if (bytes.length < 24 || !imageBytesMatch(bytes, 12, [0x49, 0x48, 0x44, 0x52])) {
                    throw new Error('The PNG image header is malformed.');
                }
                return { format: 'PNG', width: readImageU32Be(bytes, 16), height: readImageU32Be(bytes, 20) };
            }
            if (imageBytesMatch(bytes, 0, [0xff, 0xd8])) return inspectJpegDimensions(bytes);
            if (imageBytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46])
                && imageBytesMatch(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return inspectWebpDimensions(bytes);
            if (imageBytesMatch(bytes, 0, [0x47, 0x49, 0x46, 0x38]) && bytes.length >= 10) {
                return { format: 'GIF', width: readImageU16Le(bytes, 6), height: readImageU16Le(bytes, 8) };
            }
            if (imageBytesMatch(bytes, 0, [0x42, 0x4d]) && bytes.length >= 26) {
                var bmpWidth = readImageU32Le(bytes, 18) | 0;
                var bmpHeight = readImageU32Le(bytes, 22) | 0;
                return { format: 'BMP', width: Math.abs(bmpWidth), height: Math.abs(bmpHeight) };
            }
            if (imageBytesMatch(bytes, 0, [0x00, 0x00, 0x01, 0x00]) && bytes.length >= 8) {
                return { format: 'ICO', width: bytes[6] || 256, height: bytes[7] || 256 };
            }
            if (imageBytesMatch(bytes, 0, [0x49, 0x49, 0x2a, 0x00])
                || imageBytesMatch(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
                return { format: 'TIFF', width: null, height: null };
            }
            if (bytes.length >= 16 && imageBytesMatch(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
                var brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
                if (brand === 'avif' || brand === 'avis') {
                    return { format: 'AVIF', width: null, height: null };
                }
            }
            throw new Error('The selected file is not a supported raster image.');
        }

        function validateRenderSurfaceImageBytes(value) {
            var bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
            if (!bytes.length) throw new Error('Image bytes are missing.');
            if (bytes.byteLength > MAX_RENDER_SURFACE_IMAGE_BYTES) {
                throw new Error('The image exceeds the 16 MiB substitution limit.');
            }
            var inspected = inspectRenderSurfaceImage(bytes);
            if (inspected.width != null && inspected.height != null) {
                if (!inspected.width || !inspected.height) {
                    throw new Error('The ' + inspected.format + ' image has invalid dimensions.');
                }
                if (inspected.width > MAX_RENDER_SURFACE_IMAGE_DIMENSION
                    || inspected.height > MAX_RENDER_SURFACE_IMAGE_DIMENSION
                    || inspected.width * inspected.height > MAX_RENDER_SURFACE_IMAGE_PIXELS) {
                    throw new Error(
                        'The ' + inspected.format + ' image dimensions '
                        + inspected.width + '×' + inspected.height
                        + ' exceed the safe substitution limit.',
                    );
                }
            }
            return bytes;
        }
