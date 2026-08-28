use tauri::{LogicalPosition, LogicalSize, Position, Rect, Size};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct RenderSurfaceBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl RenderSurfaceBounds {
    pub(super) fn new(x: f64, y: f64, width: f64, height: f64) -> Result<Self, String> {
        if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
            return Err("Render surface bounds must contain finite numbers".to_string());
        }
        if width <= 0.0 || height <= 0.0 {
            return Err("Render surface width and height must be greater than zero".to_string());
        }
        Ok(Self {
            x,
            y,
            width,
            height,
        })
    }

    pub(super) fn position(self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y)
    }

    pub(super) fn size(self) -> LogicalSize<f64> {
        LogicalSize::new(self.width, self.height)
    }

    pub(super) fn rect(self) -> Rect {
        Rect {
            position: Position::Logical(self.position()),
            size: Size::Logical(self.size()),
        }
    }

    /// Keeps a staged child in the native view hierarchy and compositor, but
    /// entirely outside the clipped content rect until it is activated. Hidden
    /// WKWebViews throttle presentation callbacks, so `hide()` cannot be used
    /// as the anti-flicker fence.
    pub(super) fn staged(self) -> Self {
        let safe_offset = self.width.min(f64::MAX - 1.0) + 1.0;
        Self {
            x: -safe_offset,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }

    /// Keeps an active child compositor-visible while the parent shell needs
    /// to display a dialog or popover above it. WKWebView `hide()` throttles
    /// animation advancement, so overlays park the child outside the clipped
    /// content rect instead of changing its native visibility.
    pub(super) fn parked(self) -> Self {
        self.staged()
    }

    #[cfg(test)]
    pub(super) fn is_fully_offscreen_left(self) -> bool {
        self.x + self.width < 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::RenderSurfaceBounds;
    use tauri::{Position, Size};

    #[test]
    fn accepts_finite_positive_logical_bounds() {
        let bounds = RenderSurfaceBounds::new(10.5, -2.0, 1280.0, 720.0).expect("valid bounds");
        let rect = bounds.rect();

        assert_eq!(bounds.x, 10.5);
        assert_eq!(bounds.y, -2.0);
        assert_eq!(bounds.width, 1280.0);
        assert_eq!(bounds.height, 720.0);
        assert!(matches!(rect.position, Position::Logical(_)));
        assert!(matches!(rect.size, Size::Logical(_)));
    }

    #[test]
    fn rejects_non_finite_or_non_positive_bounds() {
        assert!(RenderSurfaceBounds::new(f64::NAN, 0.0, 1.0, 1.0).is_err());
        assert!(RenderSurfaceBounds::new(0.0, 0.0, 0.0, 1.0).is_err());
        assert!(RenderSurfaceBounds::new(0.0, 0.0, 1.0, -1.0).is_err());
        assert!(RenderSurfaceBounds::new(0.0, 0.0, f64::INFINITY, 1.0).is_err());
    }

    #[test]
    fn staged_bounds_are_full_size_but_clipped_offscreen() {
        let visible = RenderSurfaceBounds::new(120.0, 80.0, 640.0, 360.0).unwrap();
        let staged = visible.staged();

        assert_eq!(staged.width, visible.width);
        assert_eq!(staged.height, visible.height);
        assert_eq!(staged.y, visible.y);
        assert!(staged.is_fully_offscreen_left());
    }

    #[test]
    fn parked_bounds_keep_the_active_surface_compositor_visible_but_clipped() {
        let visible = RenderSurfaceBounds::new(24.0, 160.0, 900.0, 600.0).unwrap();
        let parked = visible.parked();

        assert_eq!(parked.width, visible.width);
        assert_eq!(parked.height, visible.height);
        assert_eq!(parked.y, visible.y);
        assert!(parked.is_fully_offscreen_left());
    }
}
