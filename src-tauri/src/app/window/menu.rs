use tauri::menu::{Menu, MenuItemBuilder, HELP_SUBMENU_ID};
#[cfg(target_os = "macos")]
use tauri::menu::{PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};

use crate::app::constants::{ABOUT_MENU_ID, ONLINE_DOCS_MENU_ID};

/// Construct RAV's native application menu without coupling menu details to
/// the application bootstrap lifecycle.
pub fn build_desktop_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    #[cfg(target_os = "macos")]
    {
        let pkg_info = app.package_info();
        let about_item =
            MenuItemBuilder::with_id(ABOUT_MENU_ID, "About Rive Animation Viewer").build(app)?;
        let docs_item =
            MenuItemBuilder::with_id(ONLINE_DOCS_MENU_ID, "RAV Documentation").build(app)?;

        let app_menu = Submenu::with_items(
            app,
            pkg_info.name.clone(),
            true,
            &[
                &about_item,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;

        let file_menu = Submenu::with_items(
            app,
            "File",
            true,
            &[&PredefinedMenuItem::close_window(app, None)?],
        )?;

        let edit_menu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;

        let view_menu = Submenu::with_items(
            app,
            "View",
            true,
            &[&PredefinedMenuItem::fullscreen(app, None)?],
        )?;

        let window_menu = Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;

        let help_menu =
            Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[&docs_item])?;

        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let menu = Menu::default(app)?;
        let docs_item =
            MenuItemBuilder::with_id(ONLINE_DOCS_MENU_ID, "RAV Documentation").build(app)?;
        if let Some(tauri::menu::MenuItemKind::Submenu(help_menu)) = menu.get(HELP_SUBMENU_ID) {
            help_menu.append(&docs_item)?;
        }
        Ok(menu)
    }
}
