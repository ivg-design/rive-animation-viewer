        const LAYOUT_FIT_ENUM_NAMES = Object.freeze({
            contain: 'Contain',
            cover: 'Cover',
            fill: 'Fill',
            fitWidth: 'FitWidth',
            fitHeight: 'FitHeight',
            scaleDown: 'ScaleDown',
            none: 'None',
            layout: 'Layout',
        });

        const LAYOUT_ALIGNMENT_ENUM_NAMES = Object.freeze({
            topLeft: 'TopLeft',
            topCenter: 'TopCenter',
            topRight: 'TopRight',
            centerLeft: 'CenterLeft',
            center: 'Center',
            centerRight: 'CenterRight',
            bottomLeft: 'BottomLeft',
            bottomCenter: 'BottomCenter',
            bottomRight: 'BottomRight',
        });

        function normalizeLayoutFitValue(value) {
            return LAYOUT_FITS.indexOf(value) >= 0 ? value : 'contain';
        }

        function normalizeLayoutAlignmentValue(value) {
            return LAYOUT_ALIGNMENTS.indexOf(value) >= 0 ? value : 'center';
        }

        function resolveRiveLayoutFit(rive, value) {
            var normalized = normalizeLayoutFitValue(value);
            var enumName = LAYOUT_FIT_ENUM_NAMES[normalized];
            return rive && rive.Fit && Object.prototype.hasOwnProperty.call(rive.Fit, enumName)
                ? rive.Fit[enumName]
                : normalized;
        }

        function resolveRiveLayoutAlignment(rive, value) {
            var normalized = normalizeLayoutAlignmentValue(value);
            var enumName = LAYOUT_ALIGNMENT_ENUM_NAMES[normalized];
            return rive && rive.Alignment && Object.prototype.hasOwnProperty.call(rive.Alignment, enumName)
                ? rive.Alignment[enumName]
                : normalized;
        }
