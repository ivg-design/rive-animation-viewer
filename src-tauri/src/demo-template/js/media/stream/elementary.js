        // WebCodecs HEVC output is length-prefixed on WebKit. Normalize it to
        // Annex B for native muxing; never assume that an ignored config key worked.
        function mediaAnnexBConfig(description, codec) {
            if (!description) return null;
            var data = new Uint8Array(description), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            var units = [], offset, lengthSize;
            function unit() {
                if (offset + 2 > data.length) throw new Error('Truncated video configuration.');
                var length = view.getUint16(offset); offset += 2;
                if (!length || offset + length > data.length) throw new Error('Invalid video parameter set.');
                units.push(data.slice(offset, offset + length)); offset += length;
            }
            if (codec === 'hevc') {
                if (data.length < 23 || data[0] !== 1) throw new Error('Invalid HEVC configuration.');
                lengthSize = (data[21] & 3) + 1; offset = 23;
                for (var a = 0; a < data[22]; a++) {
                    if (offset + 3 > data.length) throw new Error('Truncated HEVC array.');
                    var count = view.getUint16(offset + 1); offset += 3;
                    for (var i = 0; i < count; i++) unit();
                }
            } else {
                if (data.length < 7 || data[0] !== 1) throw new Error('Invalid AVC configuration.');
                lengthSize = (data[4] & 3) + 1; offset = 6;
                for (var s = 0; s < (data[5] & 31); s++) unit();
                if (offset >= data.length) throw new Error('Missing AVC picture parameters.');
                var pictures = data[offset++];
                for (var p = 0; p < pictures; p++) unit();
            }
            return { lengthSize: lengthSize, units: units };
        }

        function mediaAnnexBPacket(bytes, config, key) {
            if (!config) {
                if (!(bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || (bytes[2] === 0 && bytes[3] === 1)))) {
                    throw new Error('Video encoder did not provide Annex B or decoder configuration.');
                }
                return bytes;
            }
            var units = key ? config.units.slice() : [], offset = 0;
            while (offset < bytes.length) {
                if (offset + config.lengthSize > bytes.length) throw new Error('Truncated encoded NAL length.');
                var size = 0;
                for (var n = 0; n < config.lengthSize; n++) size = size * 256 + bytes[offset++];
                if (!size || offset + size > bytes.length) throw new Error('Truncated encoded NAL.');
                units.push(bytes.subarray(offset, offset + size)); offset += size;
            }
            var result = new Uint8Array(units.reduce(function (sum, unit) { return sum + 4 + unit.length; }, 0));
            offset = 0;
            units.forEach(function (unit) { result.set([0, 0, 0, 1], offset); result.set(unit, offset + 4); offset += unit.length + 4; });
            return result;
        }

        function mediaStreamPacket(chunks) {
            var size = 4 + chunks.reduce(function (sum, chunk) { return sum + 4 + chunk.length; }, 0);
            if (size > 20 * 1024 * 1024) throw new Error('Encoded video packet is too large.');
            var result = new Uint8Array(size), view = new DataView(result.buffer), offset = 4;
            view.setUint32(0, chunks.length, true);
            chunks.forEach(function (chunk) { view.setUint32(offset, chunk.length, true); result.set(chunk, offset + 4); offset += chunk.length + 4; });
            return result;
        }
